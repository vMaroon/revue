// The control page served at GET /control. Self-contained HTML + JS with no
// build step or external assets. It is served WITHOUT the token (so a browser
// can load it), holds no secrets itself, and calls the token-gated /config API
// with a token the user supplies via ?token= or the field. See docs/CONTROL.md.

export function controlPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Revue control</title>
<style>
  :root {
    --accent:#7c5cff; --accent-strong:#6647ee; --bg:#f7f6fc; --card:#fff;
    --fg:#24222f; --muted:#6e6b81; --border:#dedaf0; --ok:#299e5d; --danger:#d44852;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#1b1a24; --card:#242231; --fg:#e9e7f2; --muted:#9f9bb4; --border:#3b3750;
      --accent:#9c82ff; --accent-strong:#8a6bff; --ok:#4cc38a; --danger:#e5636d; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:14px; line-height:1.5; }
  header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--border);
    padding:14px 24px; display:flex; align-items:center; gap:12px; z-index:2; }
  header .logo { font-weight:700; color:var(--accent); font-size:18px; }
  header .path { color:var(--muted); font-family:var(--mono); font-size:12px; margin-left:auto; }
  main { max-width:860px; margin:0 auto; padding:24px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px;
    padding:18px 20px; margin:0 0 18px; }
  .card h2 { margin:0 0 4px; font-size:15px; }
  .card p.hint { margin:0 0 14px; color:var(--muted); font-size:12.5px; }
  label { display:block; font-size:12.5px; color:var(--muted); margin:12px 0 4px; }
  input[type=text], input[type=number], select, textarea {
    width:100%; padding:8px 10px; border:1px solid var(--border); border-radius:8px;
    background:var(--bg); color:var(--fg); font-size:13px; font-family:inherit; }
  input[type=text], select { font-family:var(--mono); }
  textarea { min-height:220px; font-family:var(--mono); font-size:12.5px; resize:vertical; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 18px; }
  .finders { display:flex; flex-wrap:wrap; gap:10px 18px; margin-top:6px; }
  .finders label { display:flex; align-items:center; gap:6px; margin:0; color:var(--fg);
    font-family:var(--mono); font-size:13px; }
  .finders input { width:auto; }
  .row2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  button { font:inherit; font-size:13px; border:1px solid var(--border); background:var(--card);
    color:var(--fg); border-radius:8px; padding:8px 14px; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent-strong); color:#fff; font-weight:600; }
  button:disabled { opacity:.5; cursor:default; }
  .bar { position:sticky; bottom:0; background:var(--bg); border-top:1px solid var(--border);
    padding:14px 24px; display:flex; align-items:center; gap:12px; }
  .status { font-size:13px; }
  .status.ok { color:var(--ok); } .status.err { color:var(--danger); }
  .tokrow { display:flex; gap:8px; align-items:center; }
  .tokrow input { flex:1; }
  .hidden { display:none; }
  .steps li { margin:8px 0; }
  #welcomeCard { border-color:var(--accent); }
  details { margin:10px 0; }
  summary { cursor:pointer; font-weight:600; font-size:13px; }
  .obs { margin:8px 0 8px 14px; }
  .quote { color:var(--muted); font-size:12.5px; margin:2px 0 2px 12px; }
</style>
</head>
<body>
<header>
  <span class="logo">Revue</span>
  <span>Pipeline control</span>
  <span class="path" id="configPath"></span>
</header>
<main>
  <div class="card" id="tokenCard">
    <h2>Connect</h2>
    <p class="hint">Paste the daemon token (printed on startup, or in <span class="path">~/.revue/secret</span>). Tip: open this page as <span class="path">/control?token=YOUR_TOKEN</span> to skip this.</p>
    <div class="tokrow">
      <input type="text" id="token" placeholder="token" autocomplete="off" spellcheck="false" />
      <button class="primary" id="connect">Connect</button>
    </div>
    <div class="status err" id="tokenErr"></div>
  </div>

  <div class="card hidden" id="welcomeCard">
    <h2>Welcome &mdash; three steps and your reviewer is ready</h2>
    <ol class="steps">
      <li><strong>Load the extension.</strong> <span class="path">chrome://extensions</span> &rarr; enable Developer mode &rarr; <strong>Load unpacked</strong> &rarr; pick the repo's <span class="path">extension/</span> folder.</li>
      <li><strong>Connect it.</strong> <button type="button" id="copyToken">Copy token</button> <span id="copied" class="status ok"></span> &mdash; then paste it into the extension's options page.</li>
      <li><strong>Make it sound like you.</strong> <button type="button" class="primary" id="welcomeScan">Scan my public comments</button> &mdash; profiles your public PR reviews into a proposed voice you approve below.</li>
    </ol>
    <button type="button" id="welcomeDone">Done &mdash; hide this</button>
  </div>

  <form id="form" class="hidden">
    <div class="card">
      <h2>Models</h2>
      <p class="hint">Which model runs each pipeline stage. Cheap models triage and scan; strong models verify and write. Applies to the next review.</p>
      <div class="grid" id="models"></div>
    </div>

    <div class="card">
      <h2>Finders</h2>
      <p class="hint">Dimensions the find stage runs in parallel. Triage may still narrow these per PR. Applies to the next review.</p>
      <div class="finders" id="finders"></div>
    </div>

    <div class="card">
      <h2>Execution</h2>
      <p class="hint">Concurrency and the per-agent timeout. Lower concurrency on a rate-limited subscription; raise it on a pay-as-you-go API key. Applies live.</p>
      <div class="row2">
        <div><label for="maxParallel">Max parallel agents</label><input type="number" id="maxParallel" min="1" max="16" /></div>
        <div><label for="agentTimeoutMs">Agent timeout (ms)</label><input type="number" id="agentTimeoutMs" min="10000" step="10000" /></div>
      </div>
    </div>

    <div class="card">
      <h2>Review voice</h2>
      <p class="hint">preferences/voice.md &mdash; the rules that shape every drafted comment and the summary, layered over the built-in anti-slop baseline (your rules win on conflict). Applies to the next review and chat.</p>
      <textarea id="voice" spellcheck="false"></textarea>
    </div>

    <div class="card">
      <h2>Review priorities</h2>
      <p class="hint">preferences/priorities.md &mdash; what the finders hunt for and the severity rubric. Applies to the next review.</p>
      <textarea id="priorities" spellcheck="false"></textarea>
    </div>

    <div class="card">
      <h2>Learned corrections</h2>
      <p class="hint">preferences/learnings.md &mdash; grown automatically when you edit or chat-correct a drafted comment (one <span class="path" id="learnModel"></span> call per correction), and fed back into future reviews. Prune or edit it here.</p>
      <textarea id="learnings" spellcheck="false"></textarea>
    </div>

    <div class="card">
      <h2>Style bootstrap</h2>
      <p class="hint">Profile your public GitHub PR comments &mdash; how you write, how you engage, what you review for &mdash; and propose voice/priorities rewrites grounded in quoted evidence. One <span class="path" id="styleModel"></span> call per scan; nothing is written until you apply.</p>
      <div id="styleBody"></div>
    </div>
  </form>
</main>

<div class="bar hidden" id="bar">
  <button class="primary" id="save">Save changes</button>
  <button id="reload">Discard &amp; reload</button>
  <span class="status" id="status"></span>
</div>

<script>
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let token = params.get('token') || localStorage.getItem('revueToken') || '';
let data = null;

async function api(method, body) {
  const res = await fetch('/config', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Revue-Token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ('HTTP ' + res.status));
  return res.json();
}

const MODEL_LABELS = { triage:'Triage', finder:'Finder', verifier:'Verifier', voice:'Voice / draft', chat:'Chat', style:'Style analysis', learn:'Learning distill' };

function renderModels() {
  const box = $('models'); box.innerHTML = '';
  for (const key of Object.keys(MODEL_LABELS)) {
    const wrap = document.createElement('div');
    const label = document.createElement('label'); label.textContent = MODEL_LABELS[key]; label.htmlFor = 'model_' + key;
    const sel = document.createElement('select'); sel.id = 'model_' + key;
    const current = data.config.models[key] || '';
    const options = data.knownModels.slice();
    // Preserve a configured value that isn't in the usable set so it isn't lost.
    if (current && !options.includes(current)) options.unshift(current);
    for (const m of options) {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      if (m === current) opt.selected = true;
      sel.appendChild(opt);
    }
    wrap.appendChild(label); wrap.appendChild(sel); box.appendChild(wrap);
  }
}

function renderFinders() {
  const box = $('finders'); box.innerHTML = '';
  for (const f of data.availableFinders) {
    const label = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = f;
    cb.checked = data.config.finders.includes(f);
    label.appendChild(cb); label.appendChild(document.createTextNode(f));
    box.appendChild(label);
  }
}

function fill() {
  $('configPath').textContent = data.configPath;
  renderModels();
  renderFinders();
  $('maxParallel').value = data.config.maxParallel;
  $('agentTimeoutMs').value = data.config.agentTimeoutMs;
  $('voice').value = data.preferences.voice;
  $('priorities').value = data.preferences.priorities;
  $('learnings').value = data.preferences.learnings;
  $('styleModel').textContent = data.config.models.style;
  $('learnModel').textContent = data.config.models.learn;
  $('tokenCard').classList.add('hidden');
  $('form').classList.remove('hidden');
  $('bar').classList.remove('hidden');
}

function collect() {
  const models = {};
  for (const key of Object.keys(MODEL_LABELS)) models[key] = $('model_' + key).value.trim();
  const finders = [...document.querySelectorAll('#finders input:checked')].map((c) => c.value);
  return {
    models,
    finders,
    maxParallel: Number($('maxParallel').value),
    agentTimeoutMs: Number($('agentTimeoutMs').value),
    preferences: { voice: $('voice').value, priorities: $('priorities').value, learnings: $('learnings').value },
  };
}

function setStatus(msg, ok) {
  const el = $('status'); el.textContent = msg; el.className = 'status ' + (ok ? 'ok' : 'err');
}

async function load() {
  data = await api('GET');
  fill();
  refreshStyle();
  // First-boot welcome (daemon auto-opens /control?...&welcome=1); one-time.
  if (params.get('welcome') === '1' && !localStorage.getItem('revueWelcomeDone')) {
    $('welcomeCard').classList.remove('hidden');
  }
}

$('copyToken').onclick = async () => {
  try {
    await navigator.clipboard.writeText(token);
    $('copied').textContent = 'copied';
    setTimeout(() => { $('copied').textContent = ''; }, 2000);
  } catch { $('copied').textContent = token; }
};

$('welcomeScan').onclick = () => {
  startStyle();
  $('styleBody').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

$('welcomeDone').onclick = () => {
  localStorage.setItem('revueWelcomeDone', '1');
  $('welcomeCard').classList.add('hidden');
};

// --- Style bootstrap (docs/STYLE.md) ---------------------------------------

let styleTimer = null;

async function styleApi(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Revue-Token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('unauthorized');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
  return json;
}

// All style content renders via textContent: evidence quotes are raw corpus
// text and must never reach innerHTML.
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function styleButton(label, primary, onclick) {
  const b = el('button', label, primary ? 'primary' : '');
  b.type = 'button'; // inside the form; default type would submit it
  b.onclick = onclick;
  return b;
}

function renderObservations(box, title, observations) {
  const details = document.createElement('details');
  details.appendChild(el('summary', title + ' (' + observations.length + ')'));
  for (const o of observations) {
    const item = el('div', '', 'obs');
    item.appendChild(el('div', o.observation));
    for (const q of o.evidence) item.appendChild(el('div', '“' + q + '”', 'quote'));
    details.appendChild(item);
  }
  box.appendChild(details);
}

function renderStyle(s) {
  clearTimeout(styleTimer);
  const box = $('styleBody');
  box.innerHTML = '';

  if (s.status === 'idle') {
    box.appendChild(styleButton('Scan my public comments', true, startStyle));
  } else if (s.status === 'running') {
    const p = s.progress;
    const label =
      p.phase === 'searching' ? 'Searching your PRs...' :
      p.phase === 'collecting' ? ('Collecting comments... PR ' + p.prsScanned + (p.prsTotal ? '/' + p.prsTotal : '') + ' · ' + p.comments + ' comments') :
      'Analyzing ' + p.comments + ' comments...';
    box.appendChild(el('div', label, 'status'));
    styleTimer = setTimeout(refreshStyle, 1500);
  } else if (s.status === 'error') {
    box.appendChild(el('div', s.message, 'status err'));
    box.appendChild(styleButton('Re-run', true, startStyle));
    box.appendChild(document.createTextNode(' '));
    box.appendChild(styleButton('Discard', false, discardStyle));
  } else if (s.status === 'ready') {
    const st = s.stats;
    const range = st.oldest && st.newest ? st.oldest.slice(0, 7) + ' to ' + st.newest.slice(0, 7) : '';
    box.appendChild(el('div',
      '@' + s.login + ' · ' + st.comments + ' comments (' + st.byRole.reviewer + ' reviewer / ' +
      st.byRole.author + ' author) · ' + st.repos + ' repos' + (range ? ' · ' + range : '') +
      (st.truncated ? ' · sample capped' : ''), 'hint'));
    renderObservations(box, 'Linguistic', s.profile.linguistic);
    renderObservations(box, 'Interactional', s.profile.interactional);
    renderObservations(box, 'Technical priorities', s.profile.technical);
    if (s.profile.caveats) box.appendChild(el('div', 'Caveats: ' + s.profile.caveats, 'hint'));

    box.appendChild(el('label', 'Proposed voice.md (editable)'));
    const voiceTa = document.createElement('textarea');
    voiceTa.id = 'styleVoice'; voiceTa.spellcheck = false; voiceTa.value = s.proposal.voiceMd;
    box.appendChild(voiceTa);
    box.appendChild(el('label', 'Proposed priorities.md (editable)'));
    const prioTa = document.createElement('textarea');
    prioTa.id = 'stylePriorities'; prioTa.spellcheck = false; prioTa.value = s.proposal.prioritiesMd;
    box.appendChild(prioTa);

    const row = el('div', '', 'tokrow');
    row.style.marginTop = '12px';
    row.appendChild(styleButton('Apply to preference files', true, applyStyle));
    row.appendChild(styleButton('Discard', false, discardStyle));
    if (s.appliedAt) row.appendChild(el('span', 'Applied ' + s.appliedAt.slice(0, 16).replace('T', ' '), 'status ok'));
    box.appendChild(row);
  }
}

async function refreshStyle() {
  try { renderStyle(await styleApi('GET', '/style/bootstrap')); }
  catch (e) { setStatus(e.message, false); }
}

async function startStyle() {
  try { renderStyle(await styleApi('POST', '/style/bootstrap')); }
  catch (e) { setStatus(e.message, false); }
}

async function applyStyle() {
  try {
    const state = await styleApi('POST', '/style/bootstrap/apply', {
      voiceMd: $('styleVoice').value,
      prioritiesMd: $('stylePriorities').value,
    });
    renderStyle(state);
    // The main editors now show stale text; refresh them from disk.
    data = await api('GET');
    $('voice').value = data.preferences.voice;
    $('priorities').value = data.preferences.priorities;
    setStatus('Style applied. Voice and priorities updated; applies to the next review.', true);
  } catch (e) { setStatus(e.message, false); }
}

async function discardStyle() {
  try { renderStyle(await styleApi('DELETE', '/style/bootstrap')); }
  catch (e) { setStatus(e.message, false); }
}

$('connect').onclick = async () => {
  token = $('token').value.trim();
  $('tokenErr').textContent = '';
  try { localStorage.setItem('revueToken', token); await load(); }
  catch (e) { $('tokenErr').textContent = e.message === 'unauthorized' ? 'Token rejected.' : e.message; }
};

$('save').onclick = async () => {
  $('save').disabled = true; setStatus('Saving...', true);
  try { data = await api('PUT', collect()); fill(); setStatus('Saved. Changes apply to the next review.', true); }
  catch (e) { setStatus(e.message, false); }
  finally { $('save').disabled = false; }
};

$('reload').onclick = async () => {
  setStatus('', true);
  try { await load(); setStatus('Reloaded from disk.', true); } catch (e) { setStatus(e.message, false); }
};

if (token) {
  $('token').value = token;
  load().catch((e) => { $('tokenErr').textContent = e.message === 'unauthorized' ? 'Saved token rejected; paste a fresh one.' : e.message; });
}
</script>
</body>
</html>`;
}
