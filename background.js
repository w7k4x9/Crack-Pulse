// 펄스 백그라운드 — 크랙 로그인 쿠키로 내 작품 통계를 받아 저장하고, 자동 스냅샷을 돌림.
importScripts('lib/core.js', 'lib/update-check.js');
const H = self.HH;

const API = 'https://crack-api.wrtn.ai/crack-api';
const SITE = 'https://crack.wrtn.ai/';
const MIN_GAP_MIN = 30;   // 스냅샷 최소 간격(분)
const BLOCK_HOURS = 3;    // 크랙이 요청을 막았을 때 쉬는 시간
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 저장소 ----------
const get = keys => chrome.storage.local.get(keys);
const set = obj => chrome.storage.local.set(obj);
async function meta() { return (await get('meta')).meta || {}; }
async function setMeta(patch) { const m = await meta(); Object.assign(m, patch); await set({ meta: m }); return m; }
async function settings() { return Object.assign({ auto: 0, theme: 'system' }, (await get('settings')).settings || {}); }

// ---------- 진행 상태 (화면에 알려 줌) ----------
let RUN = { busy: false, text: '' };
function progress(text) { RUN.text = text; chrome.runtime.sendMessage({ type: 'progress', run: RUN }).catch(() => {}); }

// ---------- 로그인 ----------
async function getToken() {
  try {
    const c = await chrome.cookies.get({ url: SITE, name: 'access_token' });
    if (c && c.value) return c.value;
    const all = await chrome.cookies.getAll({ name: 'access_token' });
    const hit = all.find(x => /(^|\.)wrtn\.ai$/.test(x.domain.replace(/^\./, '')));
    return hit ? hit.value : null;
  } catch (e) { return null; }
}

// ---------- 크랙 API ----------
let blockedStatus = null;
async function getJson(url, token, timeoutSec) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), (timeoutSec || 30) * 1000);
  let r;
  try {
    r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: ac.signal, credentials: 'omit', cache: 'no-store' });
  } catch (e) { throw new Error(e.name === 'AbortError' ? '응답 시간 초과' : '네트워크 오류'); }
  finally { clearTimeout(to); }
  if (r.status === 403 || r.status === 429) { blockedStatus = r.status; throw new Error('BLOCKED ' + r.status); }
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}
const pick = j => { const d = (j && (j.data || j)) || {}; return { list: d.contents || d.items || d.list || d.stories || [], next: d.nextCursor || d.cursor || null, d }; };

async function fetchSnapshot(token) {
  blockedStatus = null;
  const items = []; let cur = null, guard = 0;
  while (guard++ < 80) {
    const r = await getJson(`${API}/content/me?limit=20&sort=createdAt` + (cur ? '&cursor=' + encodeURIComponent(cur) : ''), token);
    if (r.status === 401) throw new Error('LOGIN_REQUIRED');
    if (r.status !== 200) throw new Error('내 작품 목록을 받지 못했어요 (응답 ' + r.status + ')');
    const p = pick(r.json);
    if (!p.list.length) break;
    items.push(...p.list); progress(`내 작품 ${items.length}개 읽는 중`);
    cur = p.next; if (!cur) break;
    await sleep(400);
  }
  const extra = {};
  try {
    const uid = items[0] && items[0].creator && items[0].creator.wrtnUid;
    if (uid) {
      progress('대화방 수 읽는 중');
      let c2 = null, g2 = 0;
      while (g2++ < 40) {
        const r = await getJson(`${API}/stories?creatorWrtnUid=${encodeURIComponent(uid)}&limit=50` + (c2 ? '&cursor=' + encodeURIComponent(c2) : ''), token);
        if (r.status !== 200) break;
        const p = pick(r.json);
        (p.d.stories || []).forEach(x => { extra[x._id] = x; });
        c2 = p.d.nextCursor; if (!c2) break;
        await sleep(400);
      }
    }
  } catch (e) { if (blockedStatus) throw e; }
  const todo = items.filter(x => x.sourceId && !extra[x.sourceId]);
  let tried = 0, filled = 0;
  for (const x of todo) {
    tried++; progress(`작품 상세 ${tried}/${todo.length}`);
    try {
      const r = await getJson(`${API}/${x.type === 'character' ? 'characters' : 'stories'}/${x.sourceId}`, token);
      if (r.status === 200) { let d = (r.json && (r.json.data || r.json)) || {}; d = d.story || d.character || d; if (d && (d.chatCount != null || d.createdAt)) { extra[x.sourceId] = d; filled++; } }
    } catch (e) { if (blockedStatus) throw e; }
    await sleep(200);
  }
  // 계정 정산 예상 (느릴 때가 있어서 길게 기다리고 두 번까지 다시 시도)
  let account = null, accountWhy = '';
  for (let t = 1; t <= 3 && !account; t++) {
    try {
      progress(t === 1 ? '정산 정보 읽는 중 (오래 걸릴 수 있어요)' : `정산 정보 다시 읽는 중 (${t}/3)`);
      const rv = await getJson(`${API}/creators/me/revenue`, token, 60);
      if (rv.status === 200) {
        const d = (rv.json && rv.json.data) || {};
        const n = v => (typeof v === 'number' && isFinite(v)) ? v : null;
        account = { expectedCash: n(d.expectedCash), expectedMoney: n(d.expectedMoney), monthlySuperChat: n(d.monthlySuperChat) };
        if (Object.values(account).every(v => v === null)) { account = null; accountWhy = '응답에 정산 값이 없음'; }
      } else accountWhy = '응답 ' + rv.status;
    } catch (e) { if (blockedStatus) throw e; accountWhy = String(e.message || e).slice(0, 60); }
    if (!account && t < 3) await sleep(3000);
  }
  const now = new Date();
  const works = items.map(x => {
    const e = extra[x.sourceId];
    return {
      id: x._id, sourceId: x.sourceId || null, name: x.name, type: x.type || 'story', visibility: x.visibility, adult: !!x.isAdult,
      original: !!(x.original && x.original.isOriginal), only: !!(x.onlyContent && x.onlyContent.isOnlyContent),
      msg: x.totalMessageCount || 0, like: x.likeCount || 0, comment: x.commentCount || 0,
      chat: e ? e.chatCount : null, chatUsers: e ? e.chatUserCount : null,
      created: ((e && e.createdAt) || x.createdAt || '').slice(0, 10),
    };
  });
  return { snap: H.normSnap({ snapshot_id: H.idOf(now), captured_at: now.toISOString(), account, works }), accountWhy, failed: tried - filled };
}

// ---------- 지급(출금) 정보: 세율·다음 지급일·출금 가능 잔액·지급 내역 ----------
const CASH_API = 'https://crack-api.wrtn.ai/crack-cash';
async function fetchPayout(token) {
  token = token || await getToken(); if (!token) return { ok: false, login: true };
  const g = async path => { const r = await commentsGet(CASH_API + path, token); if (r.status !== 200) throw new Error('응답 ' + r.status); return (r.json && r.json.data) || {}; };
  const n = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const d = await g('/withdrawals/data');
  const list = []; let cur = null, pages = 0;
  do { const p = await g('/withdrawals?limit=20' + (cur ? '&cursor=' + encodeURIComponent(cur) : '')); (p.items || []).forEach(x => list.push({ id: x.withdrawalId, status: x.status, amount: n(x.amount), tax: n(x.tax), net: n(x.netAmount), requestedAt: x.requestedAt || null, payoutAt: x.expectedPayoutDate || null, sources: (x.amountBySource || []).map(s => ({ source: s.source, amount: n(s.amount) })) })); cur = p.nextCursor; pages++; await sleep(300); } while (cur && pages < 20);
  const payout = { at: Date.now(), taxRate: n(d.taxRate), nextPayoutDate: d.nextPayoutDate || null, minAmount: n(d.minAmount), balance: n(d.balance), withdrawable: n(d.withdrawableBalance), crackCash: n(d.crackCash), eventCash: n(d.eventCash), list };
  await set({ payout });
  return { ok: true, count: list.length };
}

// ---------- 오리지널 매입일: 작품 댓글에서 내가 처음 단 댓글 시각 ----------
// 작품마다 한 번만 찾고 기억함 (grantDates). 성인 인증 403은 막힘으로 보지 않음, 429만 막힘
let GRANT_BUSY = false;
async function commentsGet(url, token) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: ac.signal, credentials: 'omit', cache: 'no-store' });
    if (r.status === 429) { const e = new Error('BLOCKED 429'); e.blocked = true; throw e; }
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, json };
  } finally { clearTimeout(to); }
}
async function findGrantDates({ force = false } = {}) {
  if (GRANT_BUSY) return { ok: false, error: '이미 찾는 중이에요.' };
  const m = await meta(); if ((m.blockedUntil || 0) > Date.now()) return { ok: false, error: '크랙이 요청을 막아서 쉬는 중이에요.' };
  const token = await getToken(); if (!token) return { ok: false, login: true, error: '크랙에 로그인되어 있지 않아요.' };
  const { snaps = [], grantDates = {} } = await get(['snaps', 'grantDates']);
  if (!snaps.length) return { ok: true, found: 0 };
  const fams = H.families(snaps, true).filter(f => f.original && (force || !grantDates[f.key] || !grantDates[f.key].at));
  GRANT_BUSY = true; let found = 0;
  try {
    for (let i = 0; i < fams.length; i++) {
      const f = fams[i]; let best = null, denied = 0;
      chrome.runtime.sendMessage({ type: 'grantProgress', text: `댓글 확인 중 ${i + 1}/${fams.length}` }).catch(() => {});
      for (const w of f.members.filter(x => x.sourceId)) {
        let cur = null, pages = 0;
        do {
          const r = await commentsGet(`${API}/${w.type === 'character' ? 'characters' : 'stories'}/${w.sourceId}/comments?sort=createdAt&limit=50` + (cur ? '&cursor=' + encodeURIComponent(cur) : ''), token);
          if (r.status !== 200) { if (r.status === 403) denied++; break; }
          const d = (r.json && r.json.data) || {};
          (d.comments || []).forEach(c => { if (c.isCreator && c.createdAt && (!best || c.createdAt < best.at)) best = { at: c.createdAt, text: String(c.content || '').replace(/\s+/g, ' ').slice(0, 40) }; });
          cur = d.nextCursor; pages++;
          await sleep(250);
        } while (cur && pages < 80);
      }
      grantDates[f.key] = best ? { at: best.at, text: best.text, checkedAt: Date.now() } : { at: null, denied: !!denied, checkedAt: Date.now() };
      if (best) found++;
      await set({ grantDates });
    }
    return { ok: true, found, checked: fams.length };
  } catch (e) {
    if (e.blocked) { await setMeta({ blockedUntil: Date.now() + BLOCK_HOURS * 3600000 }); return { ok: false, blocked: true, error: '크랙이 요청을 막은 것 같아요. 3시간 쉬어요.' }; }
    return { ok: false, error: String(e.message || e) };
  } finally { GRANT_BUSY = false; chrome.runtime.sendMessage({ type: 'grantProgress', text: '' }).catch(() => {}); }
}

// ---------- 스냅샷 받기 ----------
async function lockInfo() {
  const m = await meta(), now = Date.now();
  if ((m.blockedUntil || 0) > now) return { hard: true, ms: m.blockedUntil - now };
  const wait = (m.lastTaken || 0) + MIN_GAP_MIN * 60000 - now;
  return wait > 0 ? { hard: false, ms: wait } : null;
}

async function takeSnapshot({ force = false, auto = false } = {}) {
  if (RUN.busy) return { ok: false, error: '이미 받는 중이에요.' };
  const L = await lockInfo();
  if (L && L.hard) return { ok: false, error: `크랙이 요청을 막은 것 같아서 ${Math.ceil(L.ms / 60000)}분 더 쉬어요.`, blocked: true };
  if (L && !force) return { ok: false, needConfirm: true, waitMin: Math.ceil(L.ms / 60000) };
  const token = await getToken();
  if (!token) { await setMeta({ lastError: { at: Date.now(), code: 'login', text: '크랙에 로그인되어 있지 않아요.' } }); badge('!'); return { ok: false, login: true, error: '크랙에 로그인되어 있지 않아요.' }; }
  RUN = { busy: true, text: '시작하는 중' }; progress('시작하는 중');
  const keep = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000); // 오래 걸리는 동안 워커가 잠들지 않게
  try {
    const res = await fetchSnapshot(token);
    const { snaps = [], ledger = null } = await get(['snaps', 'ledger']);
    const all = H.mergeSnaps(snaps, [res.snap]);
    await set({ snaps: all, ledger: H.rebuildLedger(all, ledger) });
    await setMeta({ lastTaken: res.snap.t, lastError: null, lastResult: { at: res.snap.t, count: res.snap.works.length, account: !!res.snap.account, accountWhy: res.accountWhy, failed: res.failed, auto } });
    badge('');
    setTimeout(() => findGrantDates().catch(() => {}), 3000); // 새 오리지널이 있으면 매입일을 찾아 둠
    try { await fetchPayout(token); } catch (e) {} // 지급 정보는 실패해도 스냅샷은 그대로
    return { ok: true, id: res.snap.id, count: res.snap.works.length, account: !!res.snap.account, accountWhy: res.accountWhy };
  } catch (e) {
    const msg = String(e.message || e);
    if (/^BLOCKED/.test(msg)) {
      await setMeta({ blockedUntil: Date.now() + BLOCK_HOURS * 3600000, lastError: { at: Date.now(), code: 'blocked', text: `크랙이 요청을 막은 것 같아요 (응답 ${blockedStatus}). ${BLOCK_HOURS}시간 쉬어요.` } });
      badge('!'); return { ok: false, blocked: true, error: `크랙이 요청을 막은 것 같아요 (응답 ${blockedStatus}). 안전하게 ${BLOCK_HOURS}시간 동안 쉬어요.` };
    }
    if (msg === 'LOGIN_REQUIRED') { await setMeta({ lastError: { at: Date.now(), code: 'login', text: '로그인이 만료됐어요.' } }); badge('!'); return { ok: false, login: true, error: '크랙 로그인이 만료됐어요. 크랙에서 다시 로그인해 주세요.' }; }
    await setMeta({ lastError: { at: Date.now(), code: 'error', text: msg } }); badge('!');
    return { ok: false, error: msg };
  } finally {
    clearInterval(keep); RUN = { busy: false, text: '' };
    chrome.runtime.sendMessage({ type: 'done' }).catch(() => {});
  }
}

function badge(t) {
  chrome.action.setBadgeText({ text: t });
  if (t) chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });
}

// ---------- 자동 스냅샷: 30분마다 확인해서, 정한 간격이 지났으면 받음 ----------
async function autoCheck() {
  const s = await settings(); if (!s.auto) return;
  const m = await meta(), gap = 24 * 3600000 / s.auto - 10 * 60000;
  if (Date.now() - (m.lastTaken || 0) < gap) return;
  if ((m.blockedUntil || 0) > Date.now()) return;
  if (!(await getToken())) return; // 로그인 안 돼 있으면 조용히 넘어감 (팝업에 표시)
  await takeSnapshot({ auto: true, force: true });
}
function ensureAlarm() { chrome.alarms.get('auto', a => { if (!a) chrome.alarms.create('auto', { periodInMinutes: 30, delayInMinutes: 1 }); }); }
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'auto') { autoCheck(); self.PulseUpdate.check().catch(() => {}); } });
chrome.runtime.onInstalled.addListener(async d => {
  ensureAlarm();
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  // 업데이트 화면에서 바꿔 넣고 다시 켜진 경우: 다 됐다는 화면을 다시 열어 줌
  if (d.reason === 'update' && (await chrome.storage.local.get('updateApplied')).updateApplied) chrome.tabs.create({ url: chrome.runtime.getURL('update.html#done') });
  self.PulseUpdate.check({ force: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); autoCheck(); self.PulseUpdate.check().catch(() => {}); });

// ---------- 메시지 ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'snapshot') return takeSnapshot({ force: !!msg.force });
    if (msg.type === 'status') {
      const [m, L, tok] = await Promise.all([meta(), lockInfo(), getToken()]);
      return { run: RUN, loggedIn: !!tok, meta: m, lock: L };
    }
    if (msg.type === 'openCrack') { await chrome.tabs.create({ url: SITE }); return { ok: true }; }
    if (msg.type === 'openDashboard') { await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html' + (msg.hash || '')) }); return { ok: true }; }
    if (msg.type === 'refreshPayout') { try { return await fetchPayout(); } catch (e) { return { ok: false, error: String(e.message || e) }; } }
    if (msg.type === 'findGrantDates') return findGrantDates({ force: !!msg.force });
    if (msg.type === 'updateStatus') return msg.force ? self.PulseUpdate.check({ force: true }) : self.PulseUpdate.status();
    if (msg.type === 'openUpdate') { await chrome.tabs.create({ url: chrome.runtime.getURL('update.html') }); return { ok: true }; }
    if (msg.type === 'clearError') { await setMeta({ lastError: null }); badge(''); return { ok: true }; }
    return null;
  })().then(reply, e => reply({ ok: false, error: String(e) }));
  return true;
});
// 로그인하면 빨간 느낌표 지움
chrome.cookies.onChanged.addListener(async ch => {
  if (ch.cookie.name !== 'access_token' || ch.removed) return;
  const m = await meta(); if (m.lastError && m.lastError.code === 'login') { await setMeta({ lastError: null }); badge(''); }
});
