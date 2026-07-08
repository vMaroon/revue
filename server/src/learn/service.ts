// Learning loop: when a reviewer edits a pipeline-drafted comment (directly or
// by applying a chat revision), distill the change into preferences/learnings.md
// so future finder/drafting/chat prompts reflect it. Fire-and-forget and
// best-effort — a failed or unproductive distill never affects the request.

import type { DraftComment, RevueConfig } from '@revue/shared';
import type { AgentInvoker, LearnService } from '../interfaces';
import { readPreference, writePreference } from '../config';
import { dlog, elog } from '../log';
import { buildLearnPrompt, extractLearnings } from './prompts';

export function createLearnService(): LearnService {
  // Avoid re-distilling the same final wording for a comment (repeated saves).
  const lastLearned = new Map<string, string>();
  // One distill in flight per comment; the newest wins.
  const inFlight = new Set<string>();

  return {
    onCorrection(comment: DraftComment, config: RevueConfig, invoker: AgentInvoker): void {
      if (comment.origin !== 'pipeline' || comment.originalBody === undefined) return;
      if (comment.body.trim() === comment.originalBody.trim()) return;
      if (lastLearned.get(comment.id) === comment.body) return;
      if (inFlight.has(comment.id)) return;
      lastLearned.set(comment.id, comment.body);
      inFlight.add(comment.id);
      void distill(comment, config, invoker).finally(() => inFlight.delete(comment.id));
    },
  };
}

async function distill(comment: DraftComment, config: RevueConfig, invoker: AgentInvoker): Promise<void> {
  try {
    const current = readPreference('learnings');
    const res = await invoker.run({
      model: config.models.learn,
      prompt: buildLearnPrompt(current, comment),
      maxTurns: 1,
      tag: 'learn',
    });
    const updated = extractLearnings(res.text, current);
    if (updated.trim() !== current.trim()) {
      writePreference('learnings', updated);
      dlog('learn', `updated learnings from ${comment.path}:${comment.line}`);
    }
  } catch (err) {
    elog('learn', `distill failed for ${comment.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
