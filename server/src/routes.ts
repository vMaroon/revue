import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import type {
  ControlData,
  DraftComment,
  HealthResponse,
  PipelineStage,
  ReviewDraft,
  StageProgress,
} from '@revue/shared';
import { FINDER_DIMENSIONS, KNOWN_MODELS } from '@revue/shared';
import { configPath, projectRoot, readPreference, saveConfig, writePreference } from './config';
import { controlPage } from './control';
import { reviewId } from './store';
import type { ChatDeps, Deps, PrSnapshot } from './interfaces';

const version = (
  JSON.parse(readFileSync(path.join(projectRoot, 'server', 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

const PIPELINE_STAGES: PipelineStage[] = ['context', 'triage', 'find', 'verify', 'draft'];

// --------------------------------------------------------------------------
// Request schemas (zod v4)
// --------------------------------------------------------------------------

// GitHub owner/repo character sets. Constraining them at the boundary keeps a
// hostile or fat-fingered value (`../`, path separators) out of the review id,
// which becomes a filename in the store and a directory name in the workdir.
const ghOwner = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*)$/, 'invalid owner');
const ghRepo = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, 'invalid repo');

const createReviewSchema = z.object({
  owner: ghOwner,
  repo: ghRepo,
  number: z.number().int().positive(),
  force: z.boolean().optional(),
});

const prQuerySchema = z.object({
  owner: ghOwner,
  repo: ghRepo,
  number: z.coerce.number().int().positive(),
});

const patchReviewSchema = z.object({
  summary: z.string().optional(),
  verdict: z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']).optional(),
});

const addCommentSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']),
  startLine: z.number().int().positive().optional(),
  body: z.string().min(1),
});

const patchCommentSchema = z.object({
  body: z.string().optional(),
  status: z.enum(['proposed', 'accepted', 'discarded', 'published']).optional(),
  severity: z.enum(['blocking', 'suggestion', 'nit']).optional(),
});

const chatSchema = z.object({ message: z.string().min(1) });

const publishSchema = z.object({ dryRun: z.boolean().optional() });

const applyStyleSchema = z.object({
  voiceMd: z.string().min(1).optional(),
  prioritiesMd: z.string().min(1).optional(),
});

const updateConfigSchema = z.object({
  models: z
    .object({
      triage: z.string().min(1),
      finder: z.string().min(1),
      verifier: z.string().min(1),
      voice: z.string().min(1),
      chat: z.string().min(1),
      style: z.string().min(1),
      learn: z.string().min(1),
    })
    .partial()
    .optional(),
  finders: z.array(z.string()).optional(),
  maxParallel: z.number().int().min(1).max(16).optional(),
  agentTimeoutMs: z.number().int().min(10_000).optional(),
  preferences: z
    .object({
      voice: z.string().optional(),
      priorities: z.string().optional(),
      learnings: z.string().optional(),
    })
    .optional(),
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

function badRequest(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: z.prettifyError(error) });
}

function notFound(res: Response, what: string): void {
  res.status(404).json({ error: `${what} not found` });
}

function touch(draft: ReviewDraft): void {
  draft.updatedAt = new Date().toISOString();
}

function refreshStale(draft: ReviewDraft, snapshot: PrSnapshot): void {
  draft.stale = snapshot.meta.headSha !== draft.pr.headSha;
}

export function createRouter(deps: Deps): Router {
  const router = express.Router();
  // PR head checkout path per review; populated by the pipeline launch and
  // reused by chat so every turn does not re-fetch the repo.
  const workdirs = new Map<string, string>();

  function getDraft(req: Request, res: Response): ReviewDraft | undefined {
    const draft = deps.store.get(req.params.id ?? '');
    if (!draft) notFound(res, 'review');
    return draft;
  }

  function getComment(draft: ReviewDraft, req: Request, res: Response): DraftComment | undefined {
    const comment = draft.comments.find((c) => c.id === req.params.cid);
    if (!comment) notFound(res, 'comment');
    return comment;
  }

  function save(draft: ReviewDraft): void {
    touch(draft);
    deps.store.put(draft);
  }

  function emitReview(draft: ReviewDraft): void {
    deps.hub.emit(draft.id, { type: 'review', reviewId: draft.id, draft });
  }

  async function launchPipeline(draft: ReviewDraft, snapshot: PrSnapshot): Promise<void> {
    try {
      const workdir = await deps.github.ensureWorkdir(snapshot.meta);
      workdirs.set(draft.id, workdir);
      await deps.pipeline.run(draft, {
        config: deps.config,
        invoker: deps.invoker,
        snapshot,
        workdir,
        diff: deps.diff,
        emit: (event) => deps.hub.emit(draft.id, event),
        save: () => save(draft),
      });
    } catch (err) {
      // The runner never throws by contract; this covers ensureWorkdir.
      draft.status = 'error';
      draft.error = err instanceof Error ? err.message : String(err);
      save(draft);
      deps.hub.emit(draft.id, { type: 'error', reviewId: draft.id, message: draft.error });
    }
  }

  // ------------------------------------------------------------------------
  // Health
  // ------------------------------------------------------------------------

  router.get(
    '/health',
    wrap(async (req, res) => {
      // /health is the one route exempt from the token gate so the extension
      // can tell "daemon up" from "wrong token". Anything sensitive (the
      // GitHub login, the dataDir path) is disclosed only to a caller that
      // presents the token, and the authenticated GitHub call runs only then
      // so an unauthenticated cross-origin page cannot trigger it.
      const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
      const authed = (req.header('x-revue-token') ?? queryToken) === deps.auth.token;
      const payload: HealthResponse = {
        ok: true,
        version,
        mock: deps.config.mock,
      };
      if (authed) {
        payload.ghUser = await deps.github.ghUser().catch(() => undefined);
        payload.dataDir = deps.config.dataDir;
      }
      res.status(200).json(payload);
    }),
  );

  // ------------------------------------------------------------------------
  // Control page: GET /control serves the (ungated) HTML; the config API it
  // calls is token-gated. See docs/CONTROL.md.
  // ------------------------------------------------------------------------

  function controlData(): ControlData {
    return {
      config: {
        models: deps.config.models,
        finders: deps.config.finders,
        maxParallel: deps.config.maxParallel,
        agentTimeoutMs: deps.config.agentTimeoutMs,
        port: deps.config.port,
        mock: deps.config.mock,
      },
      preferences: {
        voice: readPreference('voice'),
        priorities: readPreference('priorities'),
        learnings: readPreference('learnings'),
      },
      availableFinders: [...FINDER_DIMENSIONS],
      knownModels: [...KNOWN_MODELS],
      configPath: configPath(),
    };
  }

  router.get('/control', (_req, res) => {
    res.type('html').send(controlPage());
  });

  router.get('/config', (_req, res) => {
    res.json(controlData());
  });

  router.put(
    '/config',
    wrap(async (req, res) => {
      const parsed = updateConfigSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const u = parsed.data;
      if (u.models) deps.config.models = { ...deps.config.models, ...u.models };
      if (u.finders) {
        const allowed = new Set<string>(FINDER_DIMENSIONS);
        deps.config.finders = [...new Set(u.finders.filter((f) => allowed.has(f)))];
      }
      if (u.maxParallel !== undefined) deps.config.maxParallel = u.maxParallel;
      if (u.agentTimeoutMs !== undefined) deps.config.agentTimeoutMs = u.agentTimeoutMs;
      if (u.preferences?.voice !== undefined) writePreference('voice', u.preferences.voice);
      if (u.preferences?.priorities !== undefined) writePreference('priorities', u.preferences.priorities);
      if (u.preferences?.learnings !== undefined) writePreference('learnings', u.preferences.learnings);
      saveConfig(deps.config);
      res.json(controlData());
    }),
  );

  // ------------------------------------------------------------------------
  // Style bootstrap (docs/STYLE.md): scan public comments -> staged proposal.
  // Progress is polled, not streamed; the control page is the client.
  // ------------------------------------------------------------------------

  router.get('/style/bootstrap', (_req, res) => {
    res.json(deps.style.get());
  });

  router.post('/style/bootstrap', (_req, res) => {
    if (deps.style.get().status === 'running') {
      res.status(409).json({ error: 'style bootstrap already running' });
      return;
    }
    res.status(202).json(deps.style.start(deps.github, deps.invoker));
  });

  router.post('/style/bootstrap/apply', (req, res) => {
    const parsed = applyStyleSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, parsed.error);
    if (deps.style.get().status !== 'ready') {
      res.status(409).json({ error: 'no ready style proposal to apply' });
      return;
    }
    res.json(deps.style.apply(parsed.data));
  });

  router.delete('/style/bootstrap', (_req, res) => {
    if (deps.style.get().status === 'running') {
      res.status(409).json({ error: 'cannot discard while running' });
      return;
    }
    res.json(deps.style.discard());
  });

  // ------------------------------------------------------------------------
  // Reviews
  // ------------------------------------------------------------------------

  router.post(
    '/reviews',
    wrap(async (req, res) => {
      const parsed = createReviewSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const ref = parsed.data;

      const existing = deps.store.get(reviewId(ref));
      if (existing && !ref.force) {
        res.status(200).json(existing);
        return;
      }

      const snapshot = await deps.github.fetchPr(ref);
      const now = new Date().toISOString();
      const draft: ReviewDraft = {
        id: reviewId(ref),
        pr: snapshot.meta,
        status: 'running',
        stages: PIPELINE_STAGES.map((stage): StageProgress => ({ stage, status: 'pending' })),
        summary: '',
        verdict: 'COMMENT',
        comments: [],
        dropped: [],
        createdAt: now,
        updatedAt: now,
      };
      deps.store.put(draft);
      res.status(202).json(draft);

      void launchPipeline(draft, snapshot);
    }),
  );

  router.get('/reviews', (req, res) => {
    const parsed = prQuerySchema.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error);
    const draft = deps.store.getByPr(parsed.data);
    if (!draft) return notFound(res, 'review');
    res.status(200).json(draft);
  });

  router.get('/reviews/:id', (req, res) => {
    const draft = getDraft(req, res);
    if (!draft) return;
    res.status(200).json(draft);
  });

  router.get('/reviews/:id/events', (req, res) => {
    const draft = getDraft(req, res);
    if (!draft) return;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event: unknown): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    // Opening snapshot so late/reconnecting subscribers converge.
    send({ type: 'review', reviewId: draft.id, draft });
    const unsubscribe = deps.hub.subscribe(draft.id, send);
    const heartbeat = setInterval(() => {
      res.write(':hb\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  router.patch('/reviews/:id', (req, res) => {
    const draft = getDraft(req, res);
    if (!draft) return;
    const parsed = patchReviewSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);

    if (parsed.data.summary !== undefined) draft.summary = parsed.data.summary;
    if (parsed.data.verdict !== undefined) draft.verdict = parsed.data.verdict;
    save(draft);
    emitReview(draft);
    res.status(200).json(draft);
  });

  // ------------------------------------------------------------------------
  // Comments
  // ------------------------------------------------------------------------

  router.post(
    '/reviews/:id/comments',
    wrap(async (req, res) => {
      const draft = getDraft(req, res);
      if (!draft) return;
      const parsed = addCommentSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const { path: filePath, line, side, startLine, body } = parsed.data;

      const snapshot = await deps.github.fetchPr(draft.pr);
      refreshStale(draft, snapshot);
      const anchor = deps.diff.validateAnchor(snapshot.files, filePath, line, side);
      if (!anchor.valid) {
        save(draft);
        res.status(400).json({ error: `invalid anchor: ${anchor.reason ?? 'line is not part of the diff'}` });
        return;
      }

      const comment: DraftComment = {
        id: `m-${randomUUID().slice(0, 8)}`,
        path: filePath,
        line,
        side,
        startLine,
        severity: 'suggestion',
        body,
        status: 'accepted',
        origin: 'manual',
        chat: [],
        hunk: deps.diff.extractHunk(snapshot.files, filePath, line, side),
        anchor: { valid: true },
        updatedAt: new Date().toISOString(),
      };
      draft.comments.push(comment);
      save(draft);
      deps.hub.emit(draft.id, { type: 'comment', reviewId: draft.id, comment });
      res.status(201).json(comment);
    }),
  );

  router.patch('/reviews/:id/comments/:cid', (req, res) => {
    const draft = getDraft(req, res);
    if (!draft) return;
    const comment = getComment(draft, req, res);
    if (!comment) return;
    const parsed = patchCommentSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);

    const bodyChanged = parsed.data.body !== undefined && parsed.data.body !== comment.body;
    if (parsed.data.body !== undefined) comment.body = parsed.data.body;
    if (parsed.data.status !== undefined) comment.status = parsed.data.status;
    if (parsed.data.severity !== undefined) comment.severity = parsed.data.severity;
    comment.updatedAt = new Date().toISOString();
    save(draft);
    deps.hub.emit(draft.id, { type: 'comment', reviewId: draft.id, comment });
    res.status(200).json(comment);
    // A reviewer's edit to a drafted comment is a correction to learn from.
    if (bodyChanged) deps.learn.onCorrection(comment, deps.config, deps.invoker);
  });

  router.delete('/reviews/:id/comments/:cid', (req, res) => {
    const draft = getDraft(req, res);
    if (!draft) return;
    const comment = getComment(draft, req, res);
    if (!comment) return;
    if (comment.origin !== 'manual') {
      res.status(409).json({ error: 'pipeline comments are discarded, not deleted' });
      return;
    }
    draft.comments = draft.comments.filter((c) => c.id !== comment.id);
    save(draft);
    deps.hub.emit(draft.id, { type: 'comment-removed', reviewId: draft.id, commentId: comment.id });
    res.status(204).end();
  });

  // ------------------------------------------------------------------------
  // Chat
  // ------------------------------------------------------------------------

  router.post(
    '/reviews/:id/comments/:cid/chat',
    wrap(async (req, res) => {
      const draft = getDraft(req, res);
      if (!draft) return;
      const comment = getComment(draft, req, res);
      if (!comment) return;
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      if (draft.status === 'running' || draft.status === 'publishing') {
        res.status(409).json({ error: `cannot chat while review is ${draft.status}` });
        return;
      }

      let workdir = workdirs.get(draft.id);
      if (workdir === undefined) {
        workdir = await deps.github.ensureWorkdir(draft.pr);
        workdirs.set(draft.id, workdir);
      }
      const chatDeps: ChatDeps = {
        config: deps.config,
        invoker: deps.invoker,
        workdir,
        emit: (event) => deps.hub.emit(draft.id, event),
        save: () => save(draft),
      };
      const result = await deps.chat.send(draft, comment, parsed.data.message, chatDeps);
      res.status(200).json(result);
    }),
  );

  // ------------------------------------------------------------------------
  // Publish
  // ------------------------------------------------------------------------

  router.post(
    '/reviews/:id/publish',
    wrap(async (req, res) => {
      const draft = getDraft(req, res);
      if (!draft) return;
      const parsed = publishSchema.safeParse(req.body ?? {});
      if (!parsed.success) return badRequest(res, parsed.error);
      if (draft.status === 'published') {
        res.status(409).json({ error: 'review already published' });
        return;
      }
      if (draft.status === 'publishing') {
        res.status(409).json({ error: 'publish already in progress' });
        return;
      }
      if (draft.status === 'running') {
        res.status(409).json({ error: 'pipeline is still running' });
        return;
      }

      const snapshot = await deps.github.fetchPr(draft.pr);
      refreshStale(draft, snapshot);
      const validation = deps.github.validate(draft, snapshot);

      if (parsed.data.dryRun) {
        save(draft);
        emitReview(draft);
        res.status(200).json(validation);
        return;
      }
      if (!validation.ok) {
        save(draft);
        emitReview(draft);
        res.status(409).json(validation);
        return;
      }

      draft.status = 'publishing';
      save(draft);
      emitReview(draft);
      try {
        const result = await deps.github.publish(draft, snapshot);
        draft.status = 'published';
        draft.published = { url: result.url, at: result.at };
        const at = new Date().toISOString();
        for (const c of draft.comments) {
          if (c.status === 'accepted') {
            c.status = 'published';
            c.updatedAt = at;
          }
        }
        save(draft);
        emitReview(draft);
        res.status(200).json(result);
      } catch (err) {
        // Failure leaves the draft usable (docs/ARCHITECTURE.md failure modes).
        draft.status = 'ready';
        save(draft);
        emitReview(draft);
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );

  return router;
}
