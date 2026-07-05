// Pipeline orchestration: context -> triage -> find -> verify -> draft.
// Mutates the draft in place, emits progress events, saves after every
// meaningful mutation, and never rejects.

import { randomUUID } from 'node:crypto';
import type {
  DraftComment,
  Finding,
  PipelineStage,
  ReviewDraft,
  StageProgress,
  Verification,
} from '@revue/shared';
import type { PipelineDeps, PipelineRunner } from '../interfaces';
import { dlog, elog } from '../log';
import { dedupe } from './dedupe';
import { FinderOut, TriageOut, VerifyOut, VoiceOut, runJson } from './schemas';
import { buildPreamble } from './prompts/preamble';
import { buildTriagePrompt } from './prompts/triage';
import { buildFinderPrompt } from './prompts/finders';
import { buildVerifyPrompt } from './prompts/verify';
import { buildVoicePrompt } from './prompts/voice';

const now = (): string => new Date().toISOString();

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createPipelineRunner(): PipelineRunner {
  return { run };
}

async function run(draft: ReviewDraft, deps: PipelineDeps): Promise<void> {
  const save = (): void => {
    draft.updatedAt = now();
    deps.save();
  };

  const stageOf = (stage: PipelineStage): StageProgress => {
    let progress = draft.stages.find((s) => s.stage === stage);
    if (!progress) {
      progress = { stage, status: 'pending' };
      draft.stages.push(progress);
    }
    return progress;
  };

  const setStage = (stage: PipelineStage, status: StageProgress['status'], detail?: string): void => {
    const progress = stageOf(stage);
    progress.status = status;
    if (detail !== undefined) progress.detail = detail;
    if (status === 'running') progress.startedAt = now();
    if (status === 'done' || status === 'error') progress.endedAt = now();
    dlog('pipeline', `${draft.id} ${stage}=${status}${detail !== undefined ? ` (${detail})` : ''}`);
    deps.emit({ type: 'stage', reviewId: draft.id, stage: progress });
    save();
  };

  try {
    const { config, snapshot } = deps;
    draft.status = 'running';
    save();

    // -- context ------------------------------------------------------------
    setStage('context', 'running');
    const preamble = buildPreamble(snapshot);
    setStage('context', 'done', `${snapshot.files.length} files at ${snapshot.meta.headSha.slice(0, 7)}`);

    // -- triage --------------------------------------------------------------
    setStage('triage', 'running');
    let finderDims = [...config.finders];
    try {
      const triage = await runJson(
        deps.invoker,
        {
          model: config.models.triage,
          prompt: buildTriagePrompt(preamble, config.finders),
          cwd: deps.workdir,
          readOnly: true,
          maxTurns: 1,
          tag: 'triage',
        },
        TriageOut,
        'TriageOut',
      );
      const chosen = triage.finders.filter((f) => config.finders.includes(f));
      if (chosen.length > 0) finderDims = chosen;
      setStage('triage', 'done', `${triage.size} ${triage.kind}; finders: ${finderDims.join(', ')}`);
    } catch (err) {
      // Triage is advisory: on failure fall back to all configured finders.
      setStage('triage', 'done', `triage failed (${errMsg(err)}); running all finders`);
    }

    // -- find ----------------------------------------------------------------
    setStage('find', 'running', `${finderDims.length} finders running`);
    const finderResults = await Promise.allSettled(
      finderDims.map((dimension) =>
        runJson(
          deps.invoker,
          {
            model: config.models.finder,
            prompt: buildFinderPrompt(preamble, dimension),
            cwd: deps.workdir,
            readOnly: true,
            maxTurns: 30,
            tag: 'finder',
          },
          FinderOut,
          'FinderOut',
        ),
      ),
    );

    const findings: Finding[] = [];
    const failedFinders: string[] = [];
    let findingSeq = 0;
    finderResults.forEach((result, i) => {
      const dimension = finderDims[i]!;
      if (result.status === 'rejected') {
        failedFinders.push(`${dimension} failed: ${errMsg(result.reason)}`);
        return;
      }
      for (const raw of result.value) {
        findingSeq++;
        const finding: Finding = { id: `f-${findingSeq}`, dimension, ...raw };
        const anchor = deps.diff.validateAnchor(snapshot.files, finding.path, finding.line, finding.side);
        if (!anchor.valid) {
          finding.verification = {
            verdict: 'REFUTED',
            notes: `invalid anchor: ${anchor.reason ?? 'line not in the diff'}`,
            model: 'anchor-validation',
          };
          draft.dropped.push(finding);
          deps.emit({ type: 'finding', reviewId: draft.id, finding });
          deps.emit({
            type: 'finding-verdict',
            reviewId: draft.id,
            findingId: finding.id,
            verification: finding.verification,
            dropped: true,
          });
          continue;
        }
        findings.push(finding);
        deps.emit({ type: 'finding', reviewId: draft.id, finding });
      }
    });
    save();
    const findDetail = [`${findings.length} findings`, ...failedFinders].join('; ');
    setStage('find', 'done', findDetail);

    // -- verify --------------------------------------------------------------
    const unique = dedupe(findings);
    setStage('verify', 'running', `verifying ${unique.length} findings`);
    const verifyResults = await Promise.allSettled(
      unique.map((finding) =>
        runJson(
          deps.invoker,
          {
            model: config.models.verifier,
            prompt: buildVerifyPrompt(preamble, finding),
            cwd: deps.workdir,
            readOnly: true,
            maxTurns: 30,
            tag: 'verify',
          },
          VerifyOut,
          'VerifyOut',
        ),
      ),
    );

    const surviving: Finding[] = [];
    verifyResults.forEach((result, i) => {
      const finding = unique[i]!;
      const verification: Verification =
        result.status === 'fulfilled'
          ? { verdict: result.value.verdict, notes: result.value.notes, model: config.models.verifier }
          : {
              verdict: 'UNCERTAIN',
              notes: `verifier failed: ${errMsg(result.reason)}`,
              model: config.models.verifier,
            };
      finding.verification = verification;
      const dropped = verification.verdict === 'REFUTED';
      if (dropped) draft.dropped.push(finding);
      else surviving.push(finding);
      deps.emit({
        type: 'finding-verdict',
        reviewId: draft.id,
        findingId: finding.id,
        verification,
        dropped,
      });
    });
    save();
    setStage('verify', 'done', `${surviving.length} kept, ${unique.length - surviving.length} refuted`);

    // -- draft (voice) ---------------------------------------------------------
    setStage('draft', 'running');
    const voice = await runJson(
      deps.invoker,
      {
        model: config.models.voice,
        prompt: buildVoicePrompt(preamble, surviving),
        cwd: deps.workdir,
        readOnly: true,
        maxTurns: 1,
        tag: 'voice',
      },
      VoiceOut,
      'VoiceOut',
    );

    let materialized = 0;
    for (const drafted of voice.comments) {
      const finding = surviving.find((f) => f.id === drafted.findingId);
      if (!finding) continue; // voice referenced a finding that did not survive
      const anchor = deps.diff.validateAnchor(snapshot.files, finding.path, finding.line, finding.side);
      const hunk = deps.diff.extractHunk(snapshot.files, finding.path, finding.line, finding.side);
      const comment: DraftComment = {
        id: `c-${randomUUID().slice(0, 8)}`,
        path: finding.path,
        line: finding.line,
        side: finding.side,
        ...(finding.startLine !== undefined ? { startLine: finding.startLine } : {}),
        severity: drafted.severity,
        body: drafted.body,
        originalBody: drafted.body,
        status: 'proposed',
        origin: 'pipeline',
        finding,
        chat: [],
        ...(hunk !== undefined ? { hunk } : {}),
        anchor,
        updatedAt: now(),
      };
      draft.comments.push(comment);
      deps.emit({ type: 'comment', reviewId: draft.id, comment });
      materialized++;
    }
    draft.summary = voice.summary;
    draft.verdict = voice.verdict;
    draft.status = 'ready';
    save();
    setStage('draft', 'done', `${materialized} comments`);

    deps.emit({ type: 'review', reviewId: draft.id, draft });
    deps.emit({ type: 'done', reviewId: draft.id });
  } catch (err) {
    const message = errMsg(err);
    elog('pipeline', `${draft.id} FAILED: ${message}`);
    draft.status = 'error';
    draft.error = message;
    for (const progress of draft.stages) {
      if (progress.status === 'running') {
        progress.status = 'error';
        progress.detail = message;
        progress.endedAt = now();
        deps.emit({ type: 'stage', reviewId: draft.id, stage: progress });
      }
    }
    deps.emit({ type: 'error', reviewId: draft.id, message });
    save();
  }
}
