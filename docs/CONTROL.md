<sub>[revue](../README.md) · docs · **Control**</sub>

# Control page

> Tune models, finders, concurrency, and the review voice live — no file editing, no restart.

A daemon-served page for tuning the pipeline without editing files by hand.
Open it at:

```
http://127.0.0.1:7388/control?token=<secret>
```

The daemon prints this URL (with the token filled in) on startup. The `?token=`
is optional — the page also accepts the token in a field and remembers it in
`localStorage`. The extension panel also has a **tune** button in its header
that opens this page (the service worker fills in the port and token).

On its first boot (fresh `${dataDir}/secret`) the daemon opens this page itself
with `&welcome=1`, which shows a one-time onboarding card: load the unpacked
extension, copy the token into its options page, and kick off the
[style bootstrap](STYLE.md). `REVUE_NO_OPEN=1` disables the auto-open; the card
stays dismissed once you click done.

## What it tunes

| Section | Fields | Applies |
|---|---|---|
| Models | the model for each stage (triage, finder, verifier, voice, chat) | next review |
| Finders | which finder dimensions the find stage runs | next review |
| Execution | `maxParallel` (concurrent agents), `agentTimeoutMs` (per-agent ceiling) | live |
| Review voice | full text of `preferences/voice.md` | next review + chat |
| Review priorities | full text of `preferences/priorities.md` | next review |
| Style bootstrap | scan your public PR comments into proposed voice/priorities rewrites; edit, then apply or discard ([STYLE.md](STYLE.md)) | next review + chat |

Model and finder changes take effect on the next review because the pipeline
reads `config` per run. Concurrency and the timeout are read live by the agent
invoker, so they apply to in-flight and future calls. The preference files are
read through a cache that the page busts on save, so edits apply on the next
review and chat with no restart.

## Persistence

Config changes are written to the file config was loaded from (the repo-root
`revue.config.json`, or `~/.revue/config.json`), shown at the top of the page.
Preference edits are written to `preferences/voice.md` and
`preferences/priorities.md`. All are plain files you can also edit or commit by
hand.

## API and auth

The page is a thin client over two endpoints (see [API.md](API.md)):

- `GET /config` -> `ControlData` (config, both preference files, catalogs).
- `PUT /config` -> body `UpdateControlRequest`; validates, persists, updates
  the live config, returns the new `ControlData`.

`GET /control` serves the HTML **without** the token (so a browser can load it;
it carries no secrets). `GET`/`PUT /config` are token-gated like every other
route, and the page supplies the token on those calls. Validation rejects an
out-of-range `maxParallel` (1-16), a sub-10s timeout, empty model ids, and
unknown finder names.

---

<sub>**revue docs** · [Architecture](ARCHITECTURE.md) · [Pipeline](PIPELINE.md) · [Extension](EXTENSION.md) · [API](API.md) · [Control](CONTROL.md) · [Learning](LEARNING.md) · [Style](STYLE.md) · [README](../README.md)</sub>
