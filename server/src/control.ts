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
      <p class="hint">preferences/voice.md &mdash; the rules that shape every drafted comment and the summary. Applies to the next review and chat.</p>
      <textarea id="voice" spellcheck="false"></textarea>
    </div>

    <div class="card">
      <h2>Review priorities</h2>
      <p class="hint">preferences/priorities.md &mdash; what the finders hunt for and the severity rubric. Applies to the next review.</p>
      <textarea id="priorities" spellcheck="false"></textarea>
    </div>

    <div class="card">
      <h2>Learned corrections</h2>
      <p class="hint">preferences/learnings.md &mdash; grown automatically when you edit or chat-correct a drafted comment, and fed back into future reviews. Prune or edit it here.</p>
      <textarea id="learnings" spellcheck="false"></textarea>
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

const MODEL_LABELS = { triage:'Triage', finder:'Finder', verifier:'Verifier', voice:'Voice / draft', chat:'Chat' };

function renderModels() {
  const box = $('models'); box.innerHTML = '';
  for (const key of Object.keys(MODEL_LABELS)) {
    const wrap = document.createElement('div');
    const label = document.createElement('label'); label.textContent = MODEL_LABELS[key]; label.htmlFor = 'model_' + key;
    const sel = document.createElement('input'); sel.type = 'text'; sel.id = 'model_' + key;
    sel.setAttribute('list', 'modelList'); sel.value = data.config.models[key] || '';
    wrap.appendChild(label); wrap.appendChild(sel); box.appendChild(wrap);
  }
  let dl = $('modelList');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'modelList'; document.body.appendChild(dl); }
  dl.innerHTML = data.knownModels.map((m) => '<option value="' + m + '">').join('');
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
