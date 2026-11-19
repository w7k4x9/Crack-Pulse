// 펄스 백그라운드 — 크랙 로그인 쿠키로 내 작품 통계를 받아 저장하고, 자동 스냅샷을 돌림.
importScripts('lib/core.js', 'lib/update-check.js', 'lib/cmt-core.js');
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
  // 할 일: 매입일(첫 댓글)을 아직 못 찾았거나, 시리즈 정보가 없거나 일주일 넘게 지난 오리지널 작품
  const needC = f => force || !grantDates[f.key] || (!grantDates[f.key].at && !grantDates[f.key].denied);
  const needS = f => force || !grantDates[f.key] || !Array.isArray(grantDates[f.key].series) || Date.now() - (grantDates[f.key].seriesAt || 0) > 7 * 86400000;
  const fams = H.families(snaps, true).filter(f => f.original && (needC(f) || needS(f)));
  GRANT_BUSY = true; let found = 0;
  try {
    for (let i = 0; i < fams.length; i++) {
      const f = fams[i], prev = grantDates[f.key] || {};
      chrome.runtime.sendMessage({ type: 'grantProgress', text: `오리지널 작품 확인 중 ${i + 1}/${fams.length}` }).catch(() => {});
      // 시리즈: 작품 상세의 series._id (이름이 달라도 같은 시리즈면 지원금은 한 번)
      if (needS(f)) {
        const series = [];
        for (const w of f.members.filter(x => x.sourceId)) {
          const r = await commentsGet(`${API}/${w.type === 'character' ? 'characters' : 'stories'}/${w.sourceId}`, token);
          if (r.status === 200) { let d = (r.json && (r.json.data || r.json)) || {}; d = d.story || d.character || d; if (d.series && d.series._id && !series.some(x => x.id === d.series._id)) series.push({ id: d.series._id, name: d.series.name || '' }); }
          await sleep(250);
        }
        grantDates[f.key] = Object.assign({}, prev, { series, seriesAt: Date.now() });
        await set({ grantDates });
      }
      if (!needC(f)) { if (grantDates[f.key].at) found++; continue; }
      let best = null, denied = 0;
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
      grantDates[f.key] = Object.assign({}, grantDates[f.key] || {}, best ? { at: best.at, text: best.text, denied: false, checkedAt: Date.now() } : { at: null, denied: !!denied, checkedAt: Date.now() });
      if (best) found++;
      await set({ grantDates });
    }
    return { ok: true, found, checked: fams.length };
  } catch (e) {
    if (e.blocked) { await setMeta({ blockedUntil: Date.now() + BLOCK_HOURS * 3600000 }); return { ok: false, blocked: true, error: '크랙이 요청을 막은 것 같아요. 3시간 쉬어요.' }; }
    return { ok: false, error: String(e.message || e) };
  } finally { GRANT_BUSY = false; chrome.runtime.sendMessage({ type: 'grantProgress', text: '' }).catch(() => {}); }
}

// ---------- 댓글: 새로 달린 댓글·답글을 모아서, 내가 아직 답하지 않은 것을 알려 줌 ----------
// 저장: cmt = { checkedAt, seenAt, works: { [sid]: { newest } }, threads: { [댓글 id]: 스레드 } } (모양은 lib/cmt-core.js)
const CK = self.PulseCmtCore;
const CMT_KEEP_DAYS = 45;      // 이보다 오래 조용한 스레드는 지움
const CMT_WINDOW_DAYS = 30;    // 처음 확인할 때 이만큼 거슬러 올라감
let CMT_BUSY = false;
async function crackSend(method, url, token, body) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(url, { method, headers: Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/json' }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: ac.signal, credentials: 'omit', cache: 'no-store' });
    if (r.status === 429) { const e = new Error('BLOCKED 429'); e.blocked = true; throw e; }
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, json };
  } catch (e) { if (e.blocked) throw e; throw new Error(e.name === 'AbortError' ? '응답 시간 초과' : '네트워크 오류'); }
  finally { clearTimeout(to); }
}
const cmtBase = (type, sid) => `${API}/${type === 'character' ? 'characters' : 'stories'}/${sid}/comments`;
const mineOf = c => !!(c.isOwner || c.isCreator);
const clip = s => String(s || '').slice(0, 1200);
const imgOf = w => (w && w.profileImage && (w.profileImage.w200 || w.profileImage.origin)) || '';
async function cmtGet() { return Object.assign({ threads: {}, works: {} }, (await get('cmt')).cmt || {}); }
function cmtCounts(C) { return CK.stats(C); }
async function cmtBadge(C) {
  const m = await meta(); if (m.lastError) return; // 빨간 ! 가 먼저
  C = C || await cmtGet(); const s = cmtCounts(C);
  chrome.action.setBadgeText({ text: s.fresh ? String(Math.min(s.fresh, 99)) : '' });
  if (s.fresh) chrome.action.setBadgeBackgroundColor({ color: '#007aff' });
}
// 답글 목록으로 스레드의 "누가 마지막에 말했나" 다시 계산
function recompute(T) {
  const rs = T.replies || [];
  let lastOther = T.mine ? 0 : CK.ts(T.at), repliedAt = 0;
  rs.forEach(r => { const a = CK.ts(r.at); if (r.mine) repliedAt = Math.max(repliedAt, a); else lastOther = Math.max(lastOther, a); });
  T.lastOther = lastOther || null; T.repliedAt = repliedAt || null;
  return T;
}
async function checkComments({ manual = false } = {}) {
  if (CMT_BUSY) return { ok: false, error: '이미 확인하는 중이에요.' };
  const m = await meta(); if ((m.blockedUntil || 0) > Date.now()) return { ok: false, blocked: true, error: '크랙이 요청을 막아서 쉬는 중이에요.' };
  const token = await getToken(); if (!token) return { ok: false, login: true, error: '크랙에 로그인되어 있지 않아요.' };
  CMT_BUSY = true;
  const keep = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  const tell = text => chrome.runtime.sendMessage({ type: 'cmtProgress', text }).catch(() => {});
  try {
    const prev = await cmtGet(), first = !prev.checkedAt, now = Date.now();
    // 1) 내 작품 목록 (비공개는 댓글이 안 달리니 뺌)
    tell('내 작품 읽는 중');
    const works = []; let cur = null, g = 0;
    while (g++ < 40) {
      const r = await crackSend('GET', `${API}/content/me?limit=20&sort=createdAt` + (cur ? '&cursor=' + encodeURIComponent(cur) : ''), token);
      if (r.status === 401) return { ok: false, login: true, error: '크랙 로그인이 만료됐어요.' };
      if (r.status !== 200) throw new Error('내 작품 목록을 받지 못했어요 (응답 ' + r.status + ')');
      const d = (r.json && r.json.data) || {}; const list = d.contents || d.items || [];
      works.push(...list); cur = d.nextCursor; if (!cur || !list.length) break;
      await sleep(300);
    }
    const W = works.filter(w => w.sourceId && w.visibility !== 'private');
    const threads = prev.threads, wstate = prev.works, needReplies = [];
    const floor = now - CMT_WINDOW_DAYS * 86400000;
    // 2) 작품마다 최신 댓글부터. 이미 본 데까지만 (처음엔 30일치, 최대 몇 쪽)
    for (let i = 0; i < W.length; i++) {
      const w = W[i], ws = wstate[w.sourceId] || {}, known = CK.ts(ws.newest);
      tell(`댓글 확인 중 ${i + 1}/${W.length}`);
      let c = null, pages = 0, newest = ws.newest || null;
      do {
        const r = await crackSend('GET', cmtBase(w.type, w.sourceId) + '?limit=20&sort=createdAt.desc' + (c ? '&cursor=' + encodeURIComponent(c) : ''), token);
        if (r.status !== 200) break; // 성인 인증 403 등은 그 작품만 건너뜀
        const d = (r.json && r.json.data) || {}, cs = d.comments || [];
        let oldest = Infinity;
        for (const x of cs) {
          const at = CK.ts(x.createdAt); oldest = Math.min(oldest, at);
          if (!newest || at > CK.ts(newest)) newest = x.createdAt;
          const old = threads[x._id];
          if (!old && at < floor) continue; // 30일보다 오래된 댓글은 새로 담지 않음
          const T = Object.assign(old || { replies: [] }, {
            id: x._id, sid: w.sourceId, type: w.type || 'story', work: w.name, adult: !!w.isAdult,
            nick: (x.writer && x.writer.nickname) || '알 수 없음', img: imgOf(x.writer), mine: mineOf(x),
            text: clip(x.content), at: x.createdAt, likes: x.likeCount || 0, liked: !!x.isLiked,
            status: x.status, blind: !!x.isBlind,
          });
          if ((x.replyCount || 0) !== (old ? old.rc : 0) && x.replyCount > 0 && x.status !== 'deleted') needReplies.push(T);
          T.rc = x.replyCount || 0;
          if (!T.rc) T.replies = [];
          threads[x._id] = recompute(T);
        }
        c = d.nextCursor; pages++;
        if (!cs.length || oldest <= known || oldest < floor) break;
        await sleep(250);
      } while (c && pages < (first ? 3 : 5));
      wstate[w.sourceId] = { newest, name: w.name };
      await sleep(250);
    }
    // 3) 답글 수가 바뀐 스레드만 답글을 읽어서, 내가 답했는지·그 뒤에 또 달렸는지 확인
    needReplies.sort((a, b) => CK.ts(b.at) - CK.ts(a.at));
    const LIMIT = first ? 250 : 120, todo = needReplies.slice(0, LIMIT);
    needReplies.slice(LIMIT).forEach(T => { T.rc = -1; T.pend = true; }); // 다음 확인 때 마저 읽음 (그 전엔 목록에 안 띄움)
    for (let i = 0; i < todo.length; i++) {
      const T = todo[i]; tell(`답글 확인 중 ${i + 1}/${todo.length}`);
      const rs = []; let c = null, pages = 0, ok = true;
      do {
        const r = await crackSend('GET', cmtBase(T.type, T.sid) + `?limit=50&parentId=${T.id}&sort=createdAt.asc` + (c ? '&cursor=' + encodeURIComponent(c) : ''), token);
        if (r.status !== 200) { ok = false; break; }
        const d = (r.json && r.json.data) || {};
        (d.comments || []).filter(x => x.status !== 'deleted').forEach(x => rs.push({ id: x._id, nick: (x.writer && x.writer.nickname) || '', mine: mineOf(x), text: clip(x.content), at: x.createdAt }));
        c = d.nextCursor; pages++; await sleep(200);
      } while (c && pages < 6);
      if (ok) { T.replies = rs; T.pend = false; recompute(T); } else { T.rc = -1; T.pend = true; } // 다음에 다시 읽게
    }
    // 4) 오래 조용한 스레드 지우기
    const cut = now - CMT_KEEP_DAYS * 86400000;
    for (const [id, T] of Object.entries(threads)) if (Math.max(CK.ts(T.at), T.lastOther || 0, T.repliedAt || 0) < cut) delete threads[id];
    // 저장: 확인하는 동안 답글을 달았거나 넘긴 게 있으면 그쪽을 살림
    const latest = await cmtGet();
    for (const [id, T] of Object.entries(threads)) {
      const L = latest.threads[id]; if (!L) continue;
      if (L.done) T.done = Math.max(T.done || 0, L.done);
      if ((L.repliedAt || 0) > (T.repliedAt || 0)) { const ids = new Set(T.replies.map(r => r.id)); L.replies.forEach(r => { if (!ids.has(r.id)) T.replies.push(r); }); recompute(T); }
      if (L.likedAt && L.likedAt > (prev.checkedAt || 0)) { T.liked = L.liked; T.likes = L.likes; T.likedAt = L.likedAt; }
    }
    const fresh = first ? [] : Object.values(threads).filter(T => CK.needs(T) && T.lastOther > (prev.checkedAt || 0));
    const C = { checkedAt: now, seenAt: latest.seenAt || (first ? now - 86400000 : 0), works: wstate, threads, lastError: null };
    await set({ cmt: C });
    await cmtBadge(C);
    if (fresh.length) notifyComments(fresh).catch(() => {});
    const s = cmtCounts(C);
    return { ok: true, works: W.length, need: s.need, fresh: s.fresh, added: fresh.length };
  } catch (e) {
    if (e.blocked) { await setMeta({ blockedUntil: Date.now() + BLOCK_HOURS * 3600000 }); return { ok: false, blocked: true, error: '크랙이 요청을 막은 것 같아요. 3시간 쉬어요.' }; }
    const C = await cmtGet(); C.lastError = { at: Date.now(), text: String(e.message || e) }; await set({ cmt: C });
    return { ok: false, error: String(e.message || e) };
  } finally { CMT_BUSY = false; clearInterval(keep); tell(''); }
}
async function notifyComments(list) {
  const s = await settings(); if (s.cmtNotify === false || !chrome.notifications) return;
  list.sort((a, b) => b.lastOther - a.lastOther);
  const T = list[0], p = CK.pending(T), last = p.replies.length ? p.replies[p.replies.length - 1] : null;
  const who = last ? last.nick : T.nick, text = (last ? last.text : T.text).replace(/\s+/g, ' ');
  chrome.notifications.create('cmt-' + Date.now(), {
    type: 'basic', iconUrl: 'icons/128.png', priority: 0,
    title: list.length > 1 ? `새 댓글 ${list.length}개` : `「${T.work}」 새 ${last ? '답글' : '댓글'}`,
    message: `${list.length > 1 ? `「${T.work}」 ` : ''}${who}: ${text.slice(0, 90)}`,
  });
}
if (chrome.notifications) chrome.notifications.onClicked.addListener(id => { if (/^cmt-/.test(id)) { chrome.notifications.clear(id); openComments(); } });
async function openComments() {
  const url = chrome.runtime.getURL('dashboard.html');
  try { // 이미 열린 대시보드가 있으면 그 탭을 댓글 화면으로
    const cx = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).find(c => c.documentUrl && c.documentUrl.startsWith(url) && c.tabId >= 0);
    if (cx) { const t = await chrome.tabs.update(cx.tabId, { active: true, url: url + '#comments' }); if (t && t.windowId != null) chrome.windows.update(t.windowId, { focused: true }); return; }
  } catch (e) {}
  await chrome.tabs.create({ url: url + '#comments' });
}
// 답글 달기: 크랙 사이트와 같은 방식 (POST …/comments { parentId, content })
async function replyComment({ id, content }) {
  content = String(content || '').trim();
  if (!content) return { ok: false, error: '내용이 비어 있어요.' };
  if (content.length > 1000) return { ok: false, error: '1,000자까지 쓸 수 있어요.' };
  const token = await getToken(); if (!token) return { ok: false, login: true, error: '크랙에 로그인되어 있지 않아요.' };
  const C = await cmtGet(), T = C.threads[id]; if (!T) return { ok: false, error: '댓글을 찾지 못했어요. 다시 확인해 주세요.' };
  try {
    const r = await crackSend('POST', cmtBase(T.type, T.sid), token, { parentId: T.id, content });
    if (r.status === 401) return { ok: false, login: true, error: '크랙 로그인이 만료됐어요.' };
    if (r.status !== 200 && r.status !== 201) return { ok: false, error: (r.json && (r.json.message || (r.json.error && r.json.error.message))) || `답글을 달지 못했어요 (응답 ${r.status})` };
    const d = (r.json && r.json.data) || {};
    const C2 = await cmtGet(), T2 = C2.threads[id] || T;
    T2.replies = (T2.replies || []).concat([{ id: d._id || 'local-' + Date.now(), nick: (d.writer && d.writer.nickname) || '나', mine: true, text: clip(content), at: d.createdAt || new Date().toISOString() }]);
    T2.rc = (T2.rc || 0) + 1; recompute(T2); C2.threads[id] = T2;
    await set({ cmt: C2 }); await cmtBadge(C2);
    return { ok: true };
  } catch (e) { if (e.blocked) return { ok: false, error: '크랙이 잠깐 요청을 막았어요. 조금 뒤에 다시 해 주세요.' }; return { ok: false, error: String(e.message || e) }; }
}
async function likeComment({ id, on }) {
  const token = await getToken(); if (!token) return { ok: false, login: true, error: '크랙에 로그인되어 있지 않아요.' };
  const C = await cmtGet(), T = C.threads[id]; if (!T) return { ok: false, error: '댓글을 찾지 못했어요.' };
  try {
    const r = await crackSend(on ? 'POST' : 'DELETE', cmtBase(T.type, T.sid) + '/' + T.id + '/like', token);
    if (r.status !== 200 && r.status !== 201 && r.status !== 204) return { ok: false, error: (r.json && r.json.message) || `응답 ${r.status}` };
    const C2 = await cmtGet(), T2 = C2.threads[id];
    if (T2) { if (T2.liked !== on) T2.likes = Math.max(0, (T2.likes || 0) + (on ? 1 : -1)); T2.liked = on; T2.likedAt = Date.now(); await set({ cmt: C2 }); }
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
async function cmtPatch(fn) { const C = await cmtGet(); fn(C); await set({ cmt: C }); await cmtBadge(C); return { ok: true, stats: cmtCounts(C) }; }
async function cmtAuto() {
  const s = await settings(), every = s.cmtEvery == null ? 60 : +s.cmtEvery; if (!every) return;
  const C = await cmtGet(); if (Date.now() - (C.checkedAt || 0) < every * 60000 - 5 * 60000) return;
  if (RUN.busy || !(await getToken())) return;
  await checkComments();
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
  if (!t) { chrome.action.setBadgeText({ text: '' }); cmtBadge().catch(() => {}); return; } // 빈칸이면 답글 기다리는 새 댓글 수
  chrome.action.setBadgeText({ text: t });
  chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });
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
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'auto') { autoCheck().finally(() => cmtAuto().catch(() => {})); self.PulseUpdate.check().catch(() => {}); } });
chrome.runtime.onInstalled.addListener(async d => {
  ensureAlarm();
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  // 업데이트 화면에서 바꿔 넣고 다시 켜진 경우: 다 됐다는 화면을 다시 열어 줌
  if (d.reason === 'update' && (await chrome.storage.local.get('updateApplied')).updateApplied) chrome.tabs.create({ url: chrome.runtime.getURL('update.html#done') });
  self.PulseUpdate.check({ force: true }).catch(() => {});
});
// 대시보드에서 "다시 켜기"를 눌렀으면, 다시 켜진 뒤 그 화면을 다시 열어 줌
chrome.storage.local.get('reopen').then(async ({ reopen }) => { if (!reopen) return; await chrome.storage.local.remove('reopen'); chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#' + reopen) }); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); autoCheck().finally(() => cmtAuto().catch(() => {})); self.PulseUpdate.check().catch(() => {}); });

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
    if (msg.type === 'checkComments') return checkComments({ manual: true });
    if (msg.type === 'cmtStatus') return { busy: CMT_BUSY };
    if (msg.type === 'replyComment') return replyComment(msg);
    if (msg.type === 'likeComment') return likeComment(msg);
    if (msg.type === 'cmtSeen') return cmtPatch(C => { C.seenAt = Math.max(C.seenAt || 0, msg.at || Date.now()); });
    if (msg.type === 'cmtDone') return cmtPatch(C => { const T = C.threads[msg.id]; if (T) T.done = msg.undo ? 0 : Date.now(); });
    if (msg.type === 'openComments') { await openComments(); return { ok: true }; }
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
