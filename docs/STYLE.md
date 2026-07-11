<sub>[revue](../README.md) · docs · **Style**</sub>

# Style bootstrap

> Profile your public GitHub PR comments into evidence-backed voice and priorities files — proposed, reviewed, and only then applied.

The pipeline's voice lives in `preferences/voice.md` and `preferences/priorities.md`,
layered over a built-in anti-slop baseline (`server/src/pipeline/prompts/antislop.ts`)
that keeps drafts free of machine-writing tells even when voice.md is missing
or minimal; voice.md wins over the baseline where they conflict.
Hand-writing those files means guessing at your own habits; the style bootstrap
derives them from how you actually review. It scans your recent public PR
comments, analyzes them on three levels, and proposes rewrites of both files.
Nothing is written until you review the proposal and click **Apply** on the
[control page](CONTROL.md), whose first-run welcome offers this scan as the
final onboarding step.

## The corpus

`GithubService.fetchUserComments` (`server/src/github/comments.ts`) samples
your footprint via one search — `commenter:{login} is:pr is:public`, most
recently updated first — then pulls three kinds of comment from each PR:

- **review-comment** — inline diff comments (the strongest review signal),
- **review-summary** — review bodies,
- **discussion** — PR conversation comments.

Each comment is tagged with your role on that PR: **reviewer** (someone else's
PR) or **author** (replies on your own). Author-role comments still show how
you write and argue; only reviewer-role comments say what you review *for*,
and the analysis is told to respect that split.

`style/corpus.ts` then cleans and samples: quoted reply lines (`> ...`) and
HTML comments are stripped (other people's text, bot templates), sub-8-char
acks and duplicates dropped, long comments truncated. Caps: 20 PRs, 20
comments per PR, 120 comments / ~60k chars total — enough for a stable
profile, bounded so the scan stays in tens of API calls. The stats the UI
shows (kind/role split, repos, date range, whether caps trimmed the sample)
are computed in code, not by the model.

## The analysis

One `models.style` agent call (`tag: 'style'`, single turn, no tools) takes
the corpus, the current contents of both preference files, and the finder
dimension catalog, and produces JSON per `StyleOut`
(`server/src/style/prompts.ts`):

1. **linguistic** — sentence shape, formatting habits (backticks, bullets,
   suggestion blocks), openings/closings, punctuation, stock phrases,
   prefixes like `nit:`.
2. **interactional** — directness vs. hedging (and the hedge words used), how
   disagreement is voiced, question- vs. statement-framed asks, praise
   frequency and placement, pronoun stance, behavior under pushback.
3. **technical** — which finder dimensions the comments concentrate on,
   altitude (design vs. line-level), what gets escalated as blocking vs.
   softened to a nit, evidence habits.

Evidence discipline is enforced in the prompt: every observation carries 1–3
verbatim corpus quotes, claims need support from at least two distinct
comments, and the profile describes observable communication behavior only —
no personality inference. Sample weaknesses (one dominant repo, short
timespan, few reviewer-role comments) land in an explicit `caveats` field.

## The proposal

The same call drafts `voiceMd` (levels 1–2) and `prioritiesMd` (level 3). The
current files are treated as a hand-written baseline: rules the corpus is
silent on survive, rules the corpus contradicts are revised (observed behavior
wins), and strong observed habits the files lack are added. Every line must be
a rule a model can follow while drafting, not a description of you. The
proposal never restates the built-in anti-slop baseline: where the corpus
contradicts a baseline rule (you really do use emoji), voiceMd records an
explicit override; topics the corpus is silent on stay with the baseline.

**Apply** writes three files: `preferences/voice.md`, `preferences/priorities.md`
(both through the same cache-busting writer the control page uses, so the next
review and chat pick them up with no restart), and `preferences/style-profile.md`
— the evidence-backed analysis behind the applied text, kept as reference for
you and never injected into prompts. The proposal text is editable on the
control page before applying, and all three outputs are plain markdown you can
edit or revert by hand afterwards.

The bootstrap seeds the files; the [learning loop](LEARNING.md) keeps refining
them from your per-comment corrections. Re-running later re-analyzes with the
then-current files (including accumulated learnings) as the baseline.

## Running it from the terminal

```sh
npm run style              # dry run: profile + proposed-file diffs, writes nothing
npm run style -- --apply   # also writes voice.md, priorities.md, style-profile.md
```

`server/src/style/cli.ts` runs the same scan and analysis directly — no daemon
needed, and the daemon's staged bootstrap state is untouched. It prints the
corpus stats, the three-level profile with its evidence quotes, and a
`git diff` of each proposed file against the current one, so the effect is
inspectable before anything is written. `REVUE_MOCK=1 npm run style` exercises
the flow with a real scan and canned analysis.

Preference reads are cached per on-disk mtime, so a running daemon picks up
CLI-applied (or hand-edited) files on the next read — no restart.

## State and control

One bootstrap at a time; state persists at `${dataDir}/style-bootstrap.json`
and survives restarts (a run interrupted by a daemon restart surfaces as a
re-runnable error). The control page polls progress — searching, collecting
(PRs scanned, comments gathered), analyzing — and a ready proposal keeps until
you apply, discard, or re-run. Endpoints: [API.md](API.md) §Style bootstrap.

Scope and trust: the corpus is public comments only (`is:public`), fetched
with your own `gh` token; the analysis sends that text to Claude under the
same trust boundary as PR diffs in a review. In mock mode the GitHub scan is
real but the analysis returns canned output, so the whole flow exercises with
zero token spend.

Implementation: `server/src/style/{service,corpus,prompts}.ts`,
`server/src/github/comments.ts`, wired in `server/src/routes.ts` and the
control page.

---

<sub>**revue docs** · [Architecture](ARCHITECTURE.md) · [Pipeline](PIPELINE.md) · [Extension](EXTENSION.md) · [API](API.md) · [Control](CONTROL.md) · [Learning](LEARNING.md) · [Style](STYLE.md) · [README](../README.md)</sub>
