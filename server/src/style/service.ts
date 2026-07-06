// Style bootstrap (docs/STYLE.md): scan the user's public PR comments, run
// the three-level analysis, and stage voice.md/priorities.md rewrites behind
// an explicit apply. One run at a time; state survives restarts at
// `${dataDir}/style-bootstrap.json`. The analysis core (analyzeStyle) and the
// file writer (writeStyleFiles) are shared with the CLI (style/cli.ts), which
// runs the same flow directly without daemon state.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ApplyStyleRequest,
  RevueConfig,
  StyleBootstrapState,
  StyleCorpusStats,
  StyleProfile,
  StyleProgress,
  StyleProposal,
} from '@revue/shared';
import { FINDER_DIMENSIONS } from '@revue/shared';
import { projectRoot, readPreference, writePreference } from '../config';
import { dlog, elog } from '../log';
import { runJson } from '../pipeline/schemas';
import type { AgentInvoker, GithubService, StyleService } from '../interfaces';
import { buildCorpus, renderProfileMd } from './corpus';
import { buildStylePrompt, StyleOut } from './prompts';

// Sampling caps: enough for a stable profile, bounded so the scan stays in
// tens of API calls and the analysis prompt in tens of KB.
const MAX_PRS = 20;
const MAX_COMMENTS_FETCHED = 200;
const CORPUS_CAPS = { maxComments: 120, maxChars: 60_000, maxCommentChars: 1200 };
const MIN_USABLE_COMMENTS = 5;

export interface StyleAnalysis {
  login: string;
  stats: StyleCorpusStats;
  profile: StyleProfile;
  proposal: StyleProposal;
}

/** The whole scan+analysis, independent of daemon state: resolve the login,
 *  collect and shape the corpus, run the one analysis call. Throws with a
 *  user-actionable message on any failure. */
export async function analyzeStyle(
  config: RevueConfig,
  github: GithubService,
  invoker: AgentInvoker,
  onProgress: (progress: StyleProgress) => void,
): Promise<StyleAnalysis> {
  const login = await github.ghUser();
  if (login === undefined) {
    throw new Error('GitHub login unavailable: run `gh auth login` or set GITHUB_TOKEN');
  }

  let prsScanned = 0;
  let prsTotal: number | undefined;
  const raw = await github.fetchUserComments(login, {
    maxPrs: MAX_PRS,
    maxComments: MAX_COMMENTS_FETCHED,
    onProgress: (scanned, total, comments) => {
      prsScanned = scanned;
      prsTotal = total;
      onProgress({ phase: 'collecting', prsScanned, prsTotal, comments });
    },
  });

  const corpus = buildCorpus(raw, CORPUS_CAPS);
  if (corpus.entries.length < MIN_USABLE_COMMENTS) {
    throw new Error(
      `only ${corpus.entries.length} usable public PR comments found for ${login}; ` +
        'not enough to profile a style',
    );
  }
  onProgress({ phase: 'analyzing', prsScanned, prsTotal, comments: corpus.entries.length });

  const out = await runJson(
    invoker,
    {
      model: config.models.style,
      prompt: buildStylePrompt({
        login,
        corpusText: corpus.text,
        stats: corpus.stats,
        currentVoice: readPreference('voice'),
        currentPriorities: readPreference('priorities'),
        finderDimensions: FINDER_DIMENSIONS,
      }),
      maxTurns: 1,
      tag: 'style',
    },
    StyleOut,
    'StyleOut',
  );

  return {
    login,
    stats: corpus.stats,
    profile: {
      linguistic: out.linguistic,
      interactional: out.interactional,
      technical: out.technical,
      caveats: out.caveats,
    },
    proposal: { voiceMd: out.voiceMd, prioritiesMd: out.prioritiesMd },
  };
}

/** Writes an analysis to the preference files: voice.md and priorities.md
 *  through the cache-aware writer, plus the evidence-backed
 *  preferences/style-profile.md (reference only; never injected into prompts). */
export function writeStyleFiles(analysis: StyleAnalysis): void {
  writePreference('voice', analysis.proposal.voiceMd);
  writePreference('priorities', analysis.proposal.prioritiesMd);
  writeFileSync(
    path.join(projectRoot, 'preferences', 'style-profile.md'),
    renderProfileMd(analysis.login, analysis.stats, analysis.profile),
  );
}

export function createStyleService(config: RevueConfig): StyleService {
  const statePath = path.join(config.dataDir, 'style-bootstrap.json');
  let state = hydrate(statePath);

  function persist(): void {
    if (state.status === 'idle') {
      rmSync(statePath, { force: true });
      return;
    }
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  function fail(message: string): void {
    state = { status: 'error', message };
    persist();
    elog('style', message);
  }

  async function run(github: GithubService, invoker: AgentInvoker): Promise<void> {
    try {
      const analysis = await analyzeStyle(config, github, invoker, (progress) => {
        if (state.status !== 'running') return; // discarded or superseded mid-flight
        state = { ...state, progress };
        persist();
      });
      if (state.status !== 'running') return;
      state = {
        status: 'ready',
        login: analysis.login,
        stats: analysis.stats,
        profile: analysis.profile,
        proposal: analysis.proposal,
        finishedAt: new Date().toISOString(),
      };
      persist();
      dlog('style', `profiled ${analysis.stats.comments} comments for ${analysis.login}`);
    } catch (err) {
      fail(`style bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    get: () => state,

    start(github, invoker): StyleBootstrapState {
      if (state.status === 'running') throw new Error('style bootstrap already running');
      state = {
        status: 'running',
        progress: { phase: 'searching', prsScanned: 0, comments: 0 },
        startedAt: new Date().toISOString(),
      };
      persist();
      void run(github, invoker);
      return state;
    },

    apply(overrides: ApplyStyleRequest): StyleBootstrapState {
      if (state.status !== 'ready') throw new Error('no ready style proposal to apply');
      const proposal: StyleProposal = {
        voiceMd: overrides.voiceMd ?? state.proposal.voiceMd,
        prioritiesMd: overrides.prioritiesMd ?? state.proposal.prioritiesMd,
      };
      writeStyleFiles({ login: state.login, stats: state.stats, profile: state.profile, proposal });
      state = { ...state, proposal, appliedAt: new Date().toISOString() };
      persist();
      dlog('style', 'applied style proposal to preference files');
      return state;
    },

    discard(): StyleBootstrapState {
      if (state.status === 'running') throw new Error('cannot discard while running');
      state = { status: 'idle' };
      persist();
      return state;
    },
  };
}

function hydrate(statePath: string): StyleBootstrapState {
  try {
    const loaded = JSON.parse(readFileSync(statePath, 'utf8')) as StyleBootstrapState;
    // A daemon killed mid-run leaves 'running' with the job gone; surface it
    // as re-runnable (same boot reset the review store does).
    if (loaded.status === 'running') {
      return {
        status: 'error',
        message: 'interrupted (daemon restarted); re-run the bootstrap',
        ...(loaded.login !== undefined ? { login: loaded.login } : {}),
      };
    }
    return loaded;
  } catch {
    return { status: 'idle' };
  }
}
