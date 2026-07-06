import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Octokit } from '@octokit/rest';
import type { PrFile, PrMeta, PrRef, RevueConfig } from '@revue/shared';
import type { GithubService, PrSnapshot, UserComment, UserCommentsOptions } from '../interfaces';
import { ensureWorkdir } from './workdir';
import { fetchUserComments } from './comments';
import { validate as validateDraft, publish as publishReview } from './publish';

const execFileAsync = promisify(execFile);

async function discoverToken(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    const token = stdout.trim();
    if (token !== '') return token;
  } catch {
    // gh missing or unauthenticated; fall through to the env var.
  }
  const env = process.env['GITHUB_TOKEN']?.trim();
  return env ? env : undefined;
}

function mapFileStatus(status: string): PrFile['status'] {
  if (status === 'added' || status === 'removed' || status === 'renamed') return status;
  if (status === 'copied') return 'added';
  return 'modified';
}

export function createGithubService(config: RevueConfig): GithubService {
  let tokenPromise: Promise<string | undefined> | undefined;
  let octokitPromise: Promise<Octokit> | undefined;
  let ghUserPromise: Promise<string | undefined> | undefined;

  const getToken = (): Promise<string | undefined> => (tokenPromise ??= discoverToken());
  // Unauthenticated Octokit still serves public-repo reads.
  const getOctokit = (): Promise<Octokit> =>
    (octokitPromise ??= getToken().then((token) => new Octokit(token ? { auth: token } : {})));

  return {
    async fetchPr(ref: PrRef): Promise<PrSnapshot> {
      const octokit = await getOctokit();
      const { data: pr } = await octokit.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
      });
      const files = await octokit.paginate(octokit.pulls.listFiles, {
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        per_page: 100,
      });
      const meta: PrMeta = {
        owner: ref.owner,
        repo: ref.repo,
        number: ref.number,
        title: pr.title,
        author: pr.user?.login ?? '',
        url: pr.html_url,
        headSha: pr.head.sha,
        baseRef: pr.base.ref,
        headRef: pr.head.ref,
        body: pr.body ?? '',
      };
      return {
        meta,
        files: files.map(
          (f): PrFile => ({
            path: f.filename,
            previousPath: f.previous_filename,
            status: mapFileStatus(f.status),
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch,
          }),
        ),
      };
    },

    async ensureWorkdir(meta: PrMeta): Promise<string> {
      return ensureWorkdir(config, meta, await getToken());
    },

    async fetchUserComments(login: string, opts: UserCommentsOptions): Promise<UserComment[]> {
      return fetchUserComments(await getOctokit(), login, opts);
    },

    ghUser(): Promise<string | undefined> {
      // Memoized: the authenticated login is stable for the daemon's lifetime,
      // so repeated /health checks don't each spend a GitHub API call. A failed
      // lookup isn't cached, so a later call retries.
      return (ghUserPromise ??= getOctokit()
        .then((octokit) => octokit.users.getAuthenticated())
        .then((r) => r.data.login as string | undefined)
        .catch(() => {
          ghUserPromise = undefined;
          return undefined;
        }));
    },

    validate: validateDraft,

    async publish(draft, snapshot) {
      const token = await getToken();
      if (!token) {
        throw new Error(
          'publishing requires a GitHub token: run `gh auth login` or set GITHUB_TOKEN',
        );
      }
      return publishReview(await getOctokit(), draft, snapshot);
    },
  };
}
