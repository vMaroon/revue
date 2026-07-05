import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PrRef, ReviewDraft } from '@revue/shared';
import type { Store } from './interfaces';

export function reviewId(ref: PrRef): string {
  return `${ref.owner}__${ref.repo}__${ref.number}`;
}

export function createStore(dataDir: string): Store {
  const dir = path.join(dataDir, 'reviews');
  mkdirSync(dir, { recursive: true });

  const drafts = new Map<string, ReviewDraft>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const draft = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as ReviewDraft;
      drafts.set(draft.id, draft);
    } catch {
      // A corrupt review file must not prevent boot; skip it.
    }
  }

  return {
    get: (id) => drafts.get(id),
    getByPr: (ref) => drafts.get(reviewId(ref)),
    put: (draft) => {
      drafts.set(draft.id, draft);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${draft.id}.json`), JSON.stringify(draft, null, 2));
    },
    list: () => [...drafts.values()],
  };
}
