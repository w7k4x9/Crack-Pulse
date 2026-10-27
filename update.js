'use strict';
// 깃허브에서 받은 폴더로 설치한 펄스를 그 자리에서 업데이트.
// 처음 한 번 설치 폴더를 고르면(기억해 둠) 깃허브에서 바뀐 파일만 받아 git 해시로 확인하고,
// 숨김 폴더에 먼저 써 본 뒤 제자리로 옮기고(manifest.json은 마지막) 확장 프로그램을 다시 켬.
//
// ※ 이 파일(update.js)은 고치지 않아요. 업데이트가 자기 자신을 다시 쓰면 Windows 보안이
//   새 파일을 다운로더로 보고 지우는 일이 있어서, update.js는 업데이트 대상에서 빠져요.
//   이 화면에 새로 넣을 것은 update-extra.js에 넣어요.

const U = self.PulseUpdate;
const API = `https://api.github.com/repos/${U.REPO}`;
const APPLIED = 'updateApplied';
const STAGE = '.pulse-update';
const SKIP = [/^update\.js$/, /^tests\//, /^docs\//, /(^|\/)\./, /^README\.md$/];
const $ = id => document.getElementById(id);
const manifest = chrome.runtime.getManifest();
let folder = null, info = null, busy = false;

// ---------- 작은 IndexedDB (폴더 기억용) ----------
const idb = (() => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('pulse-update', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)) };
})();

// ---------- 도우미 ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
async function gitSha(bytes) {
  const head = new TextEncoder().encode(`blob ${bytes.byteLength}\0`), all = new Uint8Array(head.length + bytes.byteLength);
  all.set(head, 0); all.set(new Uint8Array(bytes), head.length);
  return hex(await crypto.subtle.digest('SHA-1', all));
}
const wanted = p => !SKIP.some(re => re.test(p)) && !p.split('/').some(s => s === '..' || s === '');
async function dirFor(rootDir, parts, create) { let d = rootDir; for (const s of parts) d = await d.getDirectoryHandle(s, { create }); return d; }
async function readLocal(rootDir, path) { const parts = path.split('/'), name = parts.pop(); try { const d = await dirFor(rootDir, parts, false); return new Uint8Array(await (await (await d.getFileHandle(name)).getFile()).arrayBuffer()); } catch (e) { return null; } }
async function writeLocal(rootDir, path, bytes) { const parts = path.split('/'), name = parts.pop(); const d = await dirFor(rootDir, parts, true); const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(bytes); await w.close(); }
async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 403 || r.status === 429) throw new Error('GitHub가 잠깐 바빠요. 몇 분 뒤에 다시 해 주세요.');
  if (!r.ok) throw new Error(`GitHub에서 목록을 못 받았어요 (${r.status}).`);
  return r.json();
}
const ro = v => /[036]$/.test(String(v)) ? '으로' : '로';

// 고른 폴더가 지금 켜져 있는 바로 그 펄스인지: manifest.json 내용이 똑같아야 함 (고른 폴더나 그 바로 안쪽 폴더까지)
let loadedText = null;
async function resolveFolder(dir) {
  if (loadedText == null) loadedText = (await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).text()).trim();
  const others = [];
  const look = async (d, path) => {
    const b = await readLocal(d, 'manifest.json'); if (!b) return false;
    const t = new TextDecoder().decode(b); let m = null; try { m = JSON.parse(t); } catch (e) { return false; }
    if (m.key !== manifest.key) return false;
    if (t.trim() === loadedText) return true;
    others.push({ path, version: String(m.version || '?') }); return false;
  };
  if (await look(dir, dir.name)) return { match: dir, others };
  if (!others.length) for await (const [name, child] of dir.entries()) if (child.kind === 'directory' && await look(child, `${dir.name}/${name}`)) return { match: child, others };
  return { match: null, others };
}

// ---------- 화면 ----------
function show({ title, sub = '', notes = null, primary = null, secondary = null, tip = '', msg = '', manual = false }) {
  $('title').textContent = title; $('sub').textContent = sub;
  $('notes').innerHTML = (notes || []).map(n => `<section><h2>v${esc(n.version)}${n.title ? ` <span>· ${esc(n.title)}</span>` : ''}</h2>${n.items.length ? `<ul>${n.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}</section>`).join('');
  const p = $('primary'); p.hidden = !primary; if (primary) { p.textContent = primary.label; p.disabled = false; p.onclick = primary.onClick; }
  const s = $('secondary'); s.hidden = !secondary; if (secondary) { s.textContent = secondary.label; s.onclick = secondary.onClick; }
  $('tip').hidden = !tip; $('tip').textContent = tip;
  $('msg').hidden = !msg; $('msg').innerHTML = msg;
  $('manual').hidden = !manual; $('progress').hidden = true;
}
function progress(frac, text) { $('progress').hidden = false; $('barFill').style.width = Math.round(frac * 100) + '%'; $('progressText').textContent = text; }

async function render({ force = false } = {}) {
  if (location.hash === '#done') return renderDone();
  show({ title: '확인하는 중…' });
  info = await U.check({ force });
  if (!info.eligible) return show({ title: '자동으로 업데이트돼요', sub: `지금 ${manifest.version}`, msg: '웹 스토어에서 설치한 펄스는 크롬이 알아서 새 버전으로 바꿔 줘요.' });
  if (!info.available) return show({ title: '최신 버전이에요', sub: info.error ? `지금 ${info.current} · 확인하지 못했어요 (${info.error})` : `지금 ${info.current}`, secondary: { label: '다시 확인', onClick: () => render({ force: true }) } });
  renderAvailable();
}
function renderAvailable(extra = {}) {
  show(Object.assign({ title: `새 버전 ${info.latest}`, sub: `지금 쓰는 버전 ${info.current}`, notes: info.notes, primary: { label: '업데이트', onClick: start },
    tip: folder ? '바뀐 파일만 받아서 지금 폴더에 바꿔 넣어요. 기록과 설정은 그대로예요.' : '처음 한 번만, 지금 펄스가 들어 있는 폴더를 알려 주면 돼요. 다음부턴 버튼 하나예요.', manual: true }, extra));
}
async function renderDone() {
  const a = (await chrome.storage.local.get(APPLIED))[APPLIED] || {};
  show({ title: `${manifest.version}${ro(manifest.version)} 업데이트됐어요`, sub: a.from ? `${a.from} → ${manifest.version}` : '', notes: a.notes || [],
    primary: { label: '대시보드 열기', onClick: () => { location.href = chrome.runtime.getURL('dashboard.html'); } }, secondary: { label: '닫기', onClick: () => window.close() } });
  await chrome.storage.local.remove(APPLIED);
}
const WHERE = `<ol><li><a class="link" href="#" data-open-ext>폴더 위치 보기</a>를 누르면 열리는 화면의 <b>「소스」</b>에 적힌 경로가 그 폴더예요. 경로를 복사해 두세요.</li><li>아래 <b>「설치된 폴더 고르기」</b> → 뜨는 창 맨 위 주소칸에 붙여 넣고 Enter → <b>「폴더 선택」</b>.</li><li>크롬이 물으면 <b>「파일 수정 허용」</b>을 눌러요.</li></ol>`;
function renderPick(warn = '') {
  show({ title: '설치된 폴더를 알려 주세요', sub: '처음 한 번만 해요', msg: `${warn ? `<div class="warn">${warn}</div>` : ''}<b>새로 설치할 곳이 아니라</b> 지금 펄스가 <b>들어 있는</b> 폴더예요. 새 파일을 그 폴더에 바꿔 넣어요.${WHERE}`,
    primary: { label: '설치된 폴더 고르기', onClick: run }, secondary: { label: '취소', onClick: () => renderAvailable() } });
}
function start() { return folder ? run() : renderPick(); }

async function pick() {
  if (folder) {
    const mode = { mode: 'readwrite' };
    if ((await folder.queryPermission(mode)) === 'granted' || (await folder.requestPermission(mode)) === 'granted') return folder;
    folder = null; await idb.del('folder').catch(() => {});
    throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  }
  return window.showDirectoryPicker({ id: 'crack-pulse-ext', mode: 'readwrite' });
}
function blocked(path) { const e = new Error(`Windows 보안(백신)이 「${esc(path)}」 파일을 막았어요. 이번 버전은 아래 「직접 바꾸고 싶어요」로 바꿔 주세요.`); e.blockedFile = path; return e; }

async function run() {
  if (busy) return; busy = true; $('primary').disabled = true;
  try {
    let picked;
    try { picked = await pick(); }
    catch (e) {
      if (e && e.name === 'AbortError') return folder ? renderAvailable() : renderPick();
      if (e && e.name === 'NotAllowedError') return renderPick('폴더를 고쳐도 된다는 허락이 있어야 새 파일을 넣을 수 있어요. 크롬이 물으면 「파일 수정 허용」을 눌러 주세요.');
      throw new Error(`폴더를 열지 못했어요 (${(e && e.message) || e}).`);
    }
    const { match, others } = await resolveFolder(picked);
    if (!match) {
      folder = null; await idb.del('folder').catch(() => {});
      return renderPick(others.length ? `고른 「${esc(picked.name)}」 안에 펄스가 있긴 한데, 지금 켜져 있는 버전(${esc(manifest.version)})이 아닌 다른 복사본이에요 (${others.map(o => esc(o.version)).join(', ')}).` : `고른 「${esc(picked.name)}」 안에서 지금 켜져 있는 펄스를 못 찾았어요.`);
    }
    folder = match; await idb.set('folder', folder).catch(() => {});

    show({ title: `${info.latest}${ro(info.latest)} 바꾸는 중`, sub: '창을 닫지 말고 잠깐만 기다려 주세요.' });
    progress(0, '바뀐 파일을 찾는 중…');
    const commit = await getJson(`${API}/commits/${U.BRANCH}`);
    const tree = await getJson(`${API}/git/trees/${commit.commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('GitHub 파일 목록이 너무 길어서 다 못 받았어요.');
    const blobs = tree.tree.filter(t => t.type === 'blob' && wanted(t.path));
    if (!blobs.some(b => b.path === 'manifest.json')) throw new Error('GitHub에 manifest.json이 없어요.');
    const changed = [];
    for (let i = 0; i < blobs.length; i++) { const l = await readLocal(folder, blobs[i].path); if (!l || (await gitSha(l)) !== blobs[i].sha) changed.push(blobs[i]); progress(0.25 * (i + 1) / blobs.length, '바뀐 파일을 찾는 중…'); }

    // 다 받고 확인한 다음에 쓰기 시작 (중간에 끊겨도 폴더가 반쯤 바뀌지 않게)
    const files = new Map(), shaOf = new Map(changed.map(b => [b.path, b.sha]));
    for (let i = 0; i < changed.length; i++) {
      const b = changed[i], r = await fetch(`${U.RAW}${commit.sha}/${b.path.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${b.path} 파일을 못 받았어요 (${r.status}).`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if ((await gitSha(bytes)) !== b.sha) throw new Error(`${b.path} 파일이 깨져서 받아졌어요. 다시 해 주세요.`);
      files.set(b.path, bytes); progress(0.25 + 0.45 * (i + 1) / changed.length, `받는 중 ${i + 1}/${changed.length}`);
    }
    const next = files.has('manifest.json') ? JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) : manifest;
    if (next.key !== manifest.key) throw new Error('받은 파일이 펄스가 아니에요.');

    // 숨김 폴더에 먼저 써 보고 다시 읽어서 확인 → 전부 무사하면 제자리로 옮김 (manifest.json은 마지막)
    const order = [...files.keys()].sort((a, b) => (a === 'manifest.json') - (b === 'manifest.json'));
    await folder.removeEntry(STAGE, { recursive: true }).catch(() => {});
    const stage = await folder.getDirectoryHandle(STAGE, { create: true });
    for (let i = 0; i < order.length; i++) { try { await writeLocal(stage, order[i], files.get(order[i])); } catch (e) { throw blocked(order[i]); } progress(0.7 + 0.15 * (i + 1) / order.length, `바꿔 넣을 준비 ${i + 1}/${order.length}`); }
    for (const p of order) { const back = await readLocal(stage, p); if (!back || (await gitSha(back)) !== shaOf.get(p)) throw blocked(p); }
    for (let i = 0; i < order.length; i++) {
      const parts = order[i].split('/'), name = parts.pop();
      const from = await (await dirFor(stage, parts, false)).getFileHandle(name), to = await dirFor(folder, parts, true);
      try { await from.move(to, name); } catch (e) { await to.removeEntry(name).catch(() => {}); await from.move(to, name); }
      progress(0.85 + 0.15 * (i + 1) / order.length, `바꿔 넣는 중 ${i + 1}/${order.length}`);
    }
    await folder.removeEntry(STAGE, { recursive: true }).catch(() => {});
    await chrome.storage.local.set({ [APPLIED]: { from: manifest.version, to: next.version, at: Date.now(), notes: info.notes || [] } });
    progress(1, '다시 켜는 중…');
    location.hash = 'done';
    setTimeout(() => chrome.runtime.reload(), 300);
  } catch (e) {
    if (folder) await folder.removeEntry(STAGE, { recursive: true }).catch(() => {});
    $('manual').open = !!(e && e.blockedFile);
    renderAvailable({ msg: `<div class="warn"><b>업데이트하지 못했어요.</b> ${e && e.blockedFile ? e.message : esc((e && e.message) || e)}<br>지금 폴더는 그대로예요.</div>` });
  } finally { busy = false; if (!$('primary').hidden) $('primary').disabled = false; }
}

document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('[data-open-ext]'); if (a) { e.preventDefault(); chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }); } });
$('zipLink').href = `https://github.com/${U.REPO}/archive/refs/heads/${U.BRANCH}.zip`;
window.addEventListener('hashchange', () => render());
(async () => { folder = await idb.get('folder').catch(() => null); await render(); })();
