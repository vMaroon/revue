import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { ensureSecret } from './auth';
import { createChatService } from './chat/service';
import { createLearnService } from './learn/service';
import { createStyleService } from './style/service';
import { loadConfig } from './config';
import { createEventHub } from './events';
import { createGithubService } from './github/client';
import { diffUtils } from './github/diff';
import { createAgentInvoker } from './pipeline/agent';
import { createPipelineRunner } from './pipeline/runner';
import { createRouter } from './routes';
import { createStore } from './store';
import { dlog } from './log';
import type { Deps } from './interfaces';

export function createApp(): { app: Express; deps: Deps; firstBoot: boolean } {
  const config = loadConfig();
  const { token, created: firstBoot } = ensureSecret(config.dataDir);

  const store = createStore(config.dataDir);

  // A daemon killed mid-run leaves drafts stuck at 'running'/'publishing'
  // with live subprocesses gone. Reset them to 'error' at boot so they are
  // re-runnable instead of frozen.
  for (const draft of store.list()) {
    if (draft.status === 'running' || draft.status === 'publishing') {
      draft.status = 'error';
      draft.error = 'interrupted (daemon restarted); re-run the review';
      for (const stage of draft.stages) {
        if (stage.status === 'running') stage.status = 'error';
      }
      draft.updatedAt = new Date().toISOString();
      store.put(draft);
      dlog('boot', `reset interrupted review ${draft.id}`);
    }
  }

  const deps: Deps = {
    config,
    store,
    hub: createEventHub(),
    github: createGithubService(config),
    diff: diffUtils,
    invoker: createAgentInvoker(config),
    pipeline: createPipelineRunner(),
    chat: createChatService(),
    learn: createLearnService(),
    style: createStyleService(config),
    auth: { token },
  };

  const app = express();

  // Request log (REVUE_DEBUG). SSE requests are long-lived, so log on finish.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    res.on('finish', () => {
      dlog('http', `${req.method} ${req.originalUrl.split('?')[0]} -> ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });

  // Permissive CORS by design: the shared token is the access control.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Revue-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Token gate; ?token= exists for the SSE endpoint (EventSource cannot set
  // headers) but is accepted everywhere.
  app.use((req: Request, res: Response, next: NextFunction) => {
    // /health and the control page HTML load without the token; the config API
    // the page then calls stays gated.
    if (req.method === 'GET' && (req.path === '/health' || req.path === '/control')) {
      next();
      return;
    }
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const presented = req.header('x-revue-token') ?? queryToken;
    if (presented !== deps.auth.token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(createRouter(deps));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // body-parser errors carry a status (400 for malformed JSON); honor it.
    const status =
      err !== null && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
        ? err.status
        : 500;
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) res.status(status).json({ error: message });
  });

  return { app, deps, firstBoot };
}
