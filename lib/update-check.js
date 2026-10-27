// 새 버전 확인 — 깃허브에서 받은 폴더로 설치한 경우(압축해제된 확장 프로그램)에만.
// 크롬은 이런 설치본을 스스로 업데이트하지 않으니, 저장소의 manifest.json 버전을 가끔 보고 알려 줌.
(function (root) {
  'use strict';
  const REPO = 'w7k4x9/Crack-Pulse';
  const BRANCH = 'main';
  const RAW = `https://raw.githubusercontent.com/${REPO}/`;
  const KEY = 'update';
  const EVERY = 3 * 3600000;

  const parse = v => String(v || '').trim().replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  function cmp(a, b) { const x = parse(a), y = parse(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0; }

  // README의 "## v2.1.0 — 제목" + "- 항목" → 지금보다 새 버전들의 바뀐 점
  function notesSince(readme, since) {
    const out = []; let cur = null;
    for (const line of String(readme || '').split(/\r?\n/)) {
      const h = line.match(/^##\s+v(\d+(?:\.\d+)*)\s*(.*)$/);
      if (h) { cur = null; if (cmp(h[1], since) > 0) { cur = { version: h[1], title: h[2].replace(/^[\s—–-]+/, '').trim(), items: [] }; out.push(cur); } continue; }
      if (/^#{1,2}\s/.test(line)) { cur = null; continue; }
      const it = cur && line.match(/^[-*]\s+(.+)$/);
      if (it && cur.items.length < 6) cur.items.push(it[1].replace(/\*\*|`/g, '').trim());
    }
    return out.sort((a, b) => cmp(b.version, a.version)).slice(0, 6);
  }
  async function eligible() { try { return (await chrome.management.getSelf()).installType === 'development'; } catch (e) { return false; } }
  const current = () => chrome.runtime.getManifest().version;
  // raw.githubusercontent는 브랜치 주소를 5분 동안 캐시해서, 방금 올린 버전이 안 보일 수 있음.
  // 그래서 먼저 최신 커밋 sha를 받고, 그 sha 주소(바뀌지 않는 주소)로 파일을 읽음. API가 막히면 브랜치 주소로.
  async function latestRef() {
    try { const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } }); if (r.ok) { const j = await r.json(); if (j && j.sha) return j.sha; } } catch (e) {}
    return BRANCH;
  }
  let REF = null;
  async function text(path) { const ref = REF || BRANCH; const r = await fetch(`${RAW}${ref}/${path}${ref === BRANCH ? '?t=' + Date.now() : ''}`, { cache: 'no-store' }); if (!r.ok) throw new Error('GitHub ' + r.status); return r.text(); }

  function describe(st, ok) {
    const cur = current(), latest = st && st.latest;
    const avail = !!(ok && latest && cmp(latest, cur) > 0);
    return { eligible: ok, current: cur, latest: latest || null, available: avail, notes: avail ? (st.notes || []).filter(n => cmp(n.version, cur) > 0) : [], checkedAt: (st && st.checkedAt) || 0, error: (st && st.error) || '' };
  }
  let inflight = null;
  async function check({ force = false } = {}) {
    const ok = await eligible();
    const st = (await chrome.storage.local.get(KEY))[KEY] || {};
    if (!ok) return describe(st, false);
    if (!force && Date.now() - (st.checkedAt || 0) < EVERY) return describe(st, true);
    if (!inflight) inflight = (async () => {
      const next = { checkedAt: Date.now(), error: '', latest: st.latest || null, notes: [] };
      try {
        REF = await latestRef();
        next.latest = String(JSON.parse(await text('manifest.json')).version || '');
        if (cmp(next.latest, current()) > 0) { try { next.notes = notesSince(await text('README.md'), current()); } catch (e) {} }
      } catch (e) { next.error = String(e.message || e); }
      await chrome.storage.local.set({ [KEY]: next });
      return next;
    })().finally(() => { inflight = null; });
    return describe(await inflight, true);
  }
  async function status() { return describe((await chrome.storage.local.get(KEY))[KEY] || {}, await eligible()); }

  root.PulseUpdate = { REPO, BRANCH, RAW, KEY, cmp, notesSince, check, status, eligible };
})(typeof self !== 'undefined' ? self : this);
