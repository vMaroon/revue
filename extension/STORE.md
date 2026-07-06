<sub>[revue](../README.md) · **Chrome Web Store listing**</sub>

# Chrome Web Store submission

Everything needed to publish the extension. Copy fields verbatim into the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole); the manifest
(`extension/manifest.json`) is the source of truth for name, version, and permissions.

## Build the upload package

```sh
npm install
npm run build -w extension       # or: npm run package (below) which rebuilds
npm run package -w extension     # minified build → extension/build/revue-<version>.zip
```

`npm run package` produces `extension/build/revue-<version>.zip` containing
`manifest.json`, `options.html`, `dist/` (minified, no sourcemaps), and `icons/`.
Upload that zip as a new item or a new version.

## Listing fields

| Field | Value |
|---|---|
| Name | Revue — staged PR reviews |
| Short name | Revue |
| Category | Developer Tools |
| Language | English |

**Summary** (132 chars max):

> Stage a whole GitHub PR review privately, converge on it with Claude per comment, then publish once as a single review.

**Description:**

> Revue turns a GitHub pull request review into a staging area. It overlays
> AI-drafted review comments inline on the real PR diff, gives each comment its
> own Claude chat thread for converging on substance and wording, and lets you
> edit, re-verify, or add your own comments — then publishes the whole batch as
> one GitHub review, only when you click Publish.
>
> Revue is the front-end for a local companion daemon that runs the review
> pipeline and talks to GitHub and Claude on your machine. The extension itself
> only renders the overlay and relays requests to that daemon on 127.0.0.1; it
> never sends your code or comments to any third-party server.
>
> Requires the Revue daemon running locally (open source; setup at the project
> repository). Nothing is posted to GitHub until you explicitly publish.

## Single purpose

Overlay locally-generated, staged pull-request review comments on github.com and
publish them, on request, as a single GitHub review.

## Permission justifications

| Permission | Why |
|---|---|
| `storage` | Persist the daemon port and the shared access token entered on the options page. |
| `host_permissions: http://127.0.0.1/*` | Talk to the user's local Revue daemon (pipeline, chats, publish). No remote hosts. |
| `content_scripts: https://github.com/*` | Detect PR pages, read the diff DOM to anchor comments, and render the review overlay and panel. |
| `action` | Toolbar button toggles the review panel on a PR page. |

## Data use disclosure

- **Does not collect or transmit user data to the developer or any third party.**
- The only stored data is the local daemon port and access token
  (`chrome.storage.sync`) — authentication information for the user's own
  localhost daemon, never sent anywhere else.
- All PR content, review comments, and Claude/GitHub traffic are handled by the
  local daemon on the user's machine, not by the extension.
- Writes to GitHub happen only on an explicit Publish action, through the daemon
  using the user's own `gh`/GitHub token.

Certify: no sale of data, no use for unrelated purposes, no creditworthiness use.

## Assets checklist

- [x] Store icon 128×128 — `icons/icon-128.png`
- [ ] Screenshots 1280×800 (or 640×400), 1–5: the inline overlay on a PR, the side panel, a per-comment chat, the publish preview
- [ ] Small promo tile 440×280 (optional but recommended)
- [ ] Privacy policy URL (a hosted copy of the Data use disclosure above)

## Regenerating icons

`icons/icon.svg` is the source. The PNGs were rendered from it and downscaled to
each size. On macOS:

```sh
cd extension/icons
for s in 16 32 48 128; do qlmanage -t -s $s -o . icon.svg && sips -z $s $s icon.svg.png --out icon-$s.png; done
rm -f icon.svg.png
```
