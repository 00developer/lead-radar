// Builds a simple one-file labeling page (data/label.html) from out/classified.json.
// The owner opens it in a browser, answers Yes/No per post, and downloads labeling.csv.
// The AI verdict is embedded (needed for the report) but hidden in the page so it cannot bias the owner.
// Usage: npm run labelpage

import fs from 'node:fs';
import path from 'node:path';
import { DATA, OUT, ROOT, ensureDir, readJson } from './config.js';

type Row = {
  post: { id: string; actor: string; url?: string | null; text: string };
  result?: { author_type: string; service?: string | null; intent_score?: number | null; reason?: string } | null;
  error?: string;
};

const j = readJson<{ model: string; rows: Row[] }>(path.join(OUT, 'classified.json'));
const failed = j.rows.filter((r) => !r.result).length;
if (failed > 5) {
  console.error(`ERROR: ${failed} of ${j.rows.length} rows have no AI result (model ${j.model}). Re-run classify first.`);
  process.exit(1);
}

const items = j.rows
  .filter((r) => r.result)
  .map((r) => ({
    id: r.post.id,
    source: r.post.actor,
    url: r.post.url ?? '',
    text: r.post.text,
    ai: r.result!.author_type,
    svc: r.result!.service ?? '',
    intent: r.result!.intent_score ?? '',
    reason: r.result!.reason ?? '',
  }));

// Safe to embed inside <script>: escape characters that could end the tag or break the JS string.
const data = JSON.stringify(items).replace(/</g, '\\u003c').replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');

const html = `<!doctype html>
<html lang="hi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lead Radar: Labeling</title>
<style>
  :root { --bg:#f6f5f2; --card:#fff; --fg:#1d1d1b; --muted:#6b6a66; --line:#dcdad3; --yes:#1e7a46; --no:#b3392f; --skip:#55606e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#17181a; --card:#212327; --fg:#ececea; --muted:#9a9a96; --line:#383a3f; --yes:#3fae70; --no:#e0645a; --skip:#8593a3; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, "Segoe UI", sans-serif; }
  main { max-width: 720px; margin: 0 auto; display: grid; gap: 14px; }
  h1 { font-size: 20px; margin: 0; }
  .help { background: var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; font-size:14px; color:var(--muted); }
  .help b { color: var(--fg); }
  .bar { height:8px; background:var(--line); border-radius:99px; overflow:hidden; }
  .bar > div { height:100%; width:0; background:var(--yes); transition: width .2s; }
  .meta { display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; font-size:14px; color:var(--muted); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; display:grid; gap:12px; }
  .text { white-space:pre-wrap; overflow-wrap:anywhere; font-size:18px; line-height:1.55; margin:0; }
  a { color: inherit; }
  .btns { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
  button { font:inherit; border:0; border-radius:10px; padding:14px 10px; cursor:pointer; color:#fff; font-weight:600; }
  .yes { background:var(--yes); } .no { background:var(--no); }
  .row { display:flex; gap:10px; flex-wrap:wrap; }
  .ghost { background:transparent; color:var(--fg); border:1px solid var(--line); font-weight:500; padding:10px 14px; }
  .skip { background:var(--skip); }
  input[type=text] { width:100%; font:inherit; padding:10px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--fg); }
  .state { font-size:14px; font-weight:600; }
  .done { text-align:center; display:grid; gap:12px; }
  kbd { border:1px solid var(--line); border-bottom-width:2px; border-radius:4px; padding:0 5px; font-size:12px; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <h1>Lead Radar: posts ko label karein</h1>
  <div class="help">
    <b>Haan (genuine buyer)</b> = is aadmi ko <b>khud</b> developer / website / app / AI tool banwana hai (apne business ya project ke liye).<br>
    <b>Nahi</b> = wo khud developer, freelancer ya agency hai, job/naukri ka post hai, spam hai, ya post ka isse koi lena-dena nahi.<br>
    Shortcut: <kbd>Y</kbd> Haan &nbsp; <kbd>N</kbd> Nahi &nbsp; <kbd>S</kbd> Skip &nbsp; <kbd>B</kbd> peeche. Progress apne aap save hota hai.
  </div>
  <div class="bar"><div id="bar"></div></div>
  <div class="meta"><span id="count"></span><span id="tally"></span></div>

  <section class="card" id="card">
    <p class="text" id="text"></p>
    <div><a id="link" href="#" target="_blank" rel="noopener noreferrer">Threads par asli post kholein</a></div>
    <input type="text" id="comment" placeholder="Optional note (jaise: budget diya hai, ya agency hai)">
    <div class="btns">
      <button class="yes" id="yes">Haan, genuine buyer (Y)</button>
      <button class="no" id="no">Nahi (N)</button>
    </div>
    <div class="row">
      <button class="ghost" id="back">Peeche (B)</button>
      <button class="ghost" id="skip">Skip (S)</button>
      <span class="state" id="state"></span>
    </div>
  </section>

  <section class="card done" id="done" hidden>
    <h1>Ho gaya!</h1>
    <p id="summary"></p>
    <button class="yes" id="download">labeling.csv download karein</button>
    <p class="help">Download hone ke baad mujhe bata dijiye. Main file khud utha lunga aur report bana dunga.</p>
    <button class="ghost" id="review">Jawab dobara dekhein</button>
  </section>

  <div class="row"><button class="ghost" id="dl2">Abhi tak ka CSV download karein</button></div>
</main>
<script>
const ITEMS = ${data};
const KEY = 'lead-radar-labels-v1';
let labels = {};
try { labels = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { labels = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(labels)); } catch (e) {} };
const $ = (id) => document.getElementById(id);
let i = 0;
const firstOpen = () => { const k = ITEMS.findIndex((it) => !labels[it.id]); return k === -1 ? ITEMS.length : k; };
i = firstOpen();

function tally() {
  const v = Object.values(labels);
  const y = v.filter((x) => x.a === 'y').length, n = v.filter((x) => x.a === 'n').length;
  $('tally').textContent = 'Haan: ' + y + '  |  Nahi: ' + n;
  $('bar').style.width = (100 * (y + n) / ITEMS.length) + '%';
}
function render() {
  tally();
  const finished = i >= ITEMS.length;
  $('card').hidden = finished; $('done').hidden = !finished;
  if (finished) {
    const v = Object.values(labels);
    $('summary').textContent = 'Kul ' + ITEMS.length + ' posts mein se ' + v.filter((x) => x.a === 'y').length + ' Haan, ' + v.filter((x) => x.a === 'n').length + ' Nahi.';
    return;
  }
  const it = ITEMS[i];
  $('count').textContent = 'Post ' + (i + 1) + ' / ' + ITEMS.length;
  $('text').textContent = it.text;
  $('link').href = it.url || '#';
  $('link').hidden = !it.url;
  const cur = labels[it.id];
  $('comment').value = cur ? (cur.c || '') : '';
  $('state').textContent = cur ? 'Aapka jawab: ' + (cur.a === 'y' ? 'Haan' : 'Nahi') : '';
}
function answer(a) {
  if (i >= ITEMS.length) return;
  labels[ITEMS[i].id] = { a: a, c: $('comment').value.trim() };
  save(); i++; render();
}
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\\n\\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function download() {
  const head = ['id','source','url','text','ai_author_type','ai_service','ai_intent','ai_reason','owner_genuine_buyer (y/n)','owner_service','owner_comment'];
  const lines = [head.join(',')];
  ITEMS.forEach((it) => {
    const l = labels[it.id] || {};
    lines.push([it.id, it.source, it.url, it.text, it.ai, it.svc, it.intent, it.reason, l.a || '', '', l.c || ''].map(csvCell).join(','));
  });
  const blob = new Blob(['\\ufeff' + lines.join('\\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'labeling.csv';
  document.body.appendChild(a); a.click(); a.remove();
}
$('yes').onclick = () => answer('y');
$('no').onclick = () => answer('n');
$('skip').onclick = () => { if (i < ITEMS.length) { i++; render(); } };
$('back').onclick = () => { if (i > 0) { i--; render(); } };
$('download').onclick = download; $('dl2').onclick = download;
$('review').onclick = () => { i = 0; render(); };
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'y') answer('y'); else if (k === 'n') answer('n'); else if (k === 's') $('skip').click(); else if (k === 'b') $('back').click();
});
render();
</script>
</body>
</html>
`;

ensureDir(DATA);
const file = path.join(DATA, 'label.html');
fs.writeFileSync(file, html);
console.log(`Labeling page: ${path.relative(ROOT, file)} (${items.length} posts)`);
