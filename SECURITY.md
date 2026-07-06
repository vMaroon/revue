# Security

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through
GitHub's [private vulnerability reporting](https://github.com/vMaroon/revue/security/advisories/new)
(the **Report a vulnerability** button under the repo's Security tab). Expect an
initial response within a week.

## Threat model

revue is local-first by design, and its trust boundary is worth stating plainly:

- **The daemon binds to `127.0.0.1` only** and gates every request except `/health`
  on a 32-byte shared secret stored at `~/.revue/secret` (mode `0600`). The secret
  is pasted once into the extension options.
- **The pipeline and chats are read-only.** Finders, verifiers, drafting, and chat
  run the Claude Agent SDK with read-only tools (Read/Grep/Glob plus read-only git)
  over a checked-out copy of the PR head. They cannot write to your repo or to GitHub.
- **GitHub is written exactly once, by you.** Nothing reaches GitHub until you click
  **Publish**, which posts a single review via the `gh`-authenticated GitHub API.
  There is no other write path.
- **Untrusted input is PR content** — diffs, titles, and file contents drafted by
  the pipeline. Treat drafted comments as model output and review them before publishing.

## Good practice

- Keep `~/.revue/secret` private; it is a bearer token for the local daemon.
- The daemon runs code review over a checked-out repo — review PRs from untrusted
  forks the way you would before checking out any untrusted branch.
- Keep `gh` and your Claude login scoped to what you actually need.

## Supported versions

revue is pre-1.0; fixes land on `main` and in the next tagged release. Track
[Releases](https://github.com/vMaroon/revue/releases) for the current build.
