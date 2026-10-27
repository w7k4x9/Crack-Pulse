// 펄스 데이터 엔진 — 스냅샷을 '일 단위 추이'로 바꿔 주는 계산 모음.
// 서비스 워커(importScripts)와 화면(script 태그) 양쪽에서 같이 씀.
(function (G) {
  'use strict';
  const DAY = 86400000;
  const pad = n => String(n).padStart(2, '0');
  const SAFE_RE = /\s*ˢᵃᶠᵉᵗʸ\s*$/;

  // ---------- 시간 ----------
  const idOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  function parseId(s) {
    const m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T_](\d\d)[:\-](\d\d))?/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
  }
  const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
  const monthKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const monthEnd = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); };
  const monthStart = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };

  // ---------- 스냅샷 정리 ----------
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  function normWork(w) {
    return {
      id: String(w.id), sourceId: w.sourceId || null, name: String(w.name || ''), type: w.type || 'story',
      visibility: w.visibility || 'public', adult: !!w.adult, original: !!w.original, only: !!w.only,
      msg: num(w.msg), like: num(w.like), comment: num(w.comment), chat: num(w.chat), chatUsers: num(w.chatUsers),
      created: w.created || '',
    };
  }
  function normSnap(o) {
    if (!o || !Array.isArray(o.works)) return null;
    const id = o.snapshot_id || o.id || o.snapshot_date || (o.captured_at && idOf(new Date(o.captured_at))) || null;
    if (!id) return null;
    const t = Date.parse(o.captured_at || '') || o.t || parseId(id);
    if (!t) return null;
    let account = null;
    if (o.account) {
      account = { expectedCash: num(o.account.expectedCash), expectedMoney: num(o.account.expectedMoney), monthlySuperChat: num(o.account.monthlySuperChat) };
      if (account.expectedCash == null && account.expectedMoney == null) account = null;
    }
    return { id: String(id), t, account, works: o.works.map(normWork) };
  }
  // 파일 내용 하나 → {snaps:[], ledger}
  function parseImport(obj) {
    const out = { snaps: [], ledger: null };
    if (!obj || typeof obj !== 'object') return out;
    if (obj.kind === 'heunghaengpan-ledger' && Array.isArray(obj.entries)) { out.ledger = obj; return out; }
    if (Array.isArray(obj.snapshots)) { obj.snapshots.forEach(s => { const n = normSnap(s); if (n) out.snaps.push(n); }); if (obj.ledger) out.ledger = obj.ledger; return out; }
    const n = normSnap(obj); if (n) out.snaps.push(n);
    return out;
  }
  function mergeSnaps(a, b) {
    const m = new Map(); a.concat(b).forEach(s => m.set(s.id, s));
    return [...m.values()].sort((x, y) => x.t - y.t);
  }
  const toFileSnap = s => ({ snapshot_date: s.id.slice(0, 10), snapshot_id: s.id, captured_at: new Date(s.t).toISOString(), count: s.works.length, account: s.account, works: s.works });

  // ---------- 수익 장부 (기록 사이 정산 증가분을 작품별로 나눔) ----------
  // 두 기록 사이 계정 정산 증가분을 작품별 대화 증가 비율로 나눔. 캐시=오리지널 외, 현금=오리지널.
  function interval(a, b) {
    const am = {}; a.works.forEach(w => am[w.id] = w);
    const ws = { c: 0, m: 0 }, wt = {};
    b.works.forEach(w => { const p = am[w.id]; const v = (p && w.msg != null && p.msg != null) ? Math.max(w.msg - p.msg, 0) : 0; wt[w.id] = v; if (w.original) ws.m += v; else ws.c += v; });
    const same = monthKey(a.t) === monthKey(b.t), ac = a.account, bc = b.account;
    const pool = k => { if (!bc || bc[k] == null) return null; if (same) { if (!ac || ac[k] == null) return null; return Math.max(bc[k] - ac[k], 0); } return Math.max(bc[k], 0); };
    const pc = pool('expectedCash'), pm = pool('expectedMoney'), w = {};
    b.works.forEach(x => { const m = !!x.original, p = m ? pm : pc, sm = m ? ws.m : ws.c, v = wt[x.id]; if (p != null && sm > 0 && v > 0) { const amt = Math.round(p * v / sm * 10) / 10; w[x.id] = m ? [0, amt] : [amt, 0]; } });
    return { from: a.id, to: b.id, cross: !same, poolC: pc, poolM: pm, w };
  }
  // 스냅샷으로 다시 계산할 수 있는 구간은 다시 계산하고, 스냅샷이 지워진 옛 구간은 장부에 남은 값을 그대로 씀
  function rebuildLedger(snaps, old) {
    const acct = snaps.filter(s => s.account);
    const fresh = [];
    for (let i = 1; i < acct.length; i++) fresh.push(interval(acct[i - 1], acct[i]));
    const keep = ((old && old.entries) || []).filter(e => !acct.length || e.to <= acct[0].id || e.from >= acct[acct.length - 1].id);
    const entries = keep.concat(fresh).sort((x, y) => x.from.localeCompare(y.from));
    return { kind: 'heunghaengpan-ledger', version: 1, entries };
  }

  // ---------- 시계열 ----------
  // points: [{t, v}] 시간순
  function valueAt(pts, t) {
    if (!pts.length || t < pts[0].t - 1 || t > pts[pts.length - 1].t + 1) return null;
    if (t <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (t <= b.t) return b.t === a.t ? b.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
    }
    return pts[pts.length - 1].v;
  }
  // 작품(여러 id의 합) 지표 시계열
  function workPoints(snaps, ids, key) {
    const set = new Set(ids), out = [];
    snaps.forEach(s => { let v = 0, any = false; s.works.forEach(w => { if (set.has(w.id) && w[key] != null) { v += w[key]; any = true; } }); if (any) out.push({ t: s.t, v, id: s.id }); });
    return out;
  }
  // 계정 정산 값: 달이 바뀌면 0부터 다시 쌓이므로, 이어 붙인 누적값으로 바꿈
  function accountPoints(snaps, key) {
    const out = []; let C = null, prev = null;
    snaps.forEach(s => {
      const v = s.account && s.account[key]; if (v == null) return;
      if (prev == null) C = v; else if (monthKey(prev.t) === monthKey(s.t)) C += v - prev.v; else C += v;
      out.push({ t: s.t, v: C, raw: v, id: s.id }); prev = { t: s.t, v };
    });
    return out;
  }
  // 하루 단위 증가량. 스냅샷 사이 날짜는 고르게 나눈 추정값(est)
  function daily(pts, fromT, toT) {
    if (pts.length < 2) return [];
    const p0 = pts[0].t, pn = pts[pts.length - 1].t;
    let d = dayStart(Math.max(fromT || p0, p0));
    const end = Math.min(toT || pn, pn), out = [];
    while (d < end) {
      const d1 = addDays(d, 1), a = Math.max(d, p0), b = Math.min(d1, pn);
      if (b > a) {
        const va = valueAt(pts, a), vb = valueAt(pts, b);
        const cover = (b - a) / (d1 - d);
        // 그날 안에 기록이 하나도 없으면 앞뒤 기록 사이를 고르게 나눈 추정값
        out.push({ t: d, v: vb - va, cover, partial: cover < 0.97, est: !pts.some(p => p.t >= d && p.t < d1) });
      }
      d = d1;
    }
    return out;
  }

  // ---------- 작품 묶음 (언세이프 + ˢᵃᶠᵉᵗʸ) ----------
  function families(snaps, group) {
    const last = snaps[snaps.length - 1]; if (!last) return [];
    const seen = new Map();
    // 지금 있는 작품 기준. 이름은 마지막 기록의 이름
    last.works.forEach(w => {
      const base = group ? w.name.replace(SAFE_RE, '').trim() : w.name;
      const key = group ? 'f:' + base + '|' + w.type : w.id;
      if (!seen.has(key)) seen.set(key, { key, name: base, type: w.type, members: [] });
      seen.get(key).members.push(w);
    });
    return [...seen.values()].map(f => {
      const m = f.members;
      const vis = m.some(x => x.visibility === 'public') ? 'public' : m.some(x => x.visibility === 'linkonly') ? 'linkonly' : 'private';
      return { ...f, ids: m.map(x => x.id), original: m.some(x => x.original), only: m.some(x => x.only), visibility: vis,
        hasSafe: m.some(x => !x.adult), hasUnsafe: m.some(x => x.adult), created: m.map(x => x.created).filter(Boolean).sort()[0] || '' };
    });
  }

  // ---------- 기간 ----------
  const PERIODS = { '1d': { days: 1, label: '24시간' }, '7d': { days: 7, label: '7일' }, '30d': { days: 30, label: '30일' }, 'all': { days: Infinity, label: '전체' } };
  function periodRange(snaps, key) {
    if (!snaps.length) return null;
    const end = snaps[snaps.length - 1].t, first = snaps[0].t, P = PERIODS[key] || PERIODS['7d'];
    const start = P.days === Infinity ? first : Math.max(first, end - P.days * DAY);
    return { start, end, days: (end - start) / DAY, want: P.days, short: P.days !== Infinity && end - P.days * DAY < first - 60000 };
  }
  // 구간 [a,b]의 증가량과 하루 평균
  function delta(pts, a, b) {
    if (pts.length < 2) return null;
    const s = Math.max(a, pts[0].t), e = Math.min(b, pts[pts.length - 1].t);
    if (e - s < 60000) return null;
    const v = valueAt(pts, e) - valueAt(pts, s);
    return { v, perDay: v / ((e - s) / DAY), days: (e - s) / DAY };
  }
  // 변화: 바로 앞의 같은 길이 기간과 비교. 기록이 모자라면 기간 후반 vs 전반으로 비교
  function momentum(pts, R) {
    if (!R || !pts.length) return null;
    const len = R.end - R.start;
    let a, b, mode;
    if (R.start - len >= pts[0].t - 60000) { a = delta(pts, R.start - len, R.start); b = delta(pts, R.start, R.end); mode = 'prev'; }
    else if (R.days >= 1.5) { const mid = R.start + len / 2; a = delta(pts, R.start, mid); b = delta(pts, mid, R.end); mode = 'half'; }
    else return null;
    // 양이 너무 적으면 몇 개 차이로 퍼센트가 크게 흔들려서 표시하지 않음
    if (!a || !b || a.perDay <= 0 || a.v + b.v < 60) return null;
    return { v: b.perDay / a.perDay - 1, mode };
  }
  // 장부에서 기간에 걸친 만큼 작품별 추정 수익 (겹친 비율만큼)
  function ledgerFor(ledger, a, b) {
    const per = {}; let C = 0, M = 0;
    ((ledger && ledger.entries) || []).forEach(e => {
      const f = parseId(e.from), t = parseId(e.to); if (!(t > f)) return;
      const ov = Math.max(0, Math.min(t, b) - Math.max(f, a)) / (t - f); if (ov <= 0) return;
      C += (e.poolC || 0) * ov; M += (e.poolM || 0) * ov;
      Object.keys(e.w || {}).forEach(id => { const c = per[id] = per[id] || [0, 0]; c[0] += e.w[id][0] * ov; c[1] += e.w[id][1] * ov; });
    });
    return { per, cash: C, money: M };
  }

  // ---------- 월말 예상 ----------
  function forecast(snaps, key) {
    const pts = accountPoints(snaps, key); if (pts.length < 2) return null;
    const L = pts[pts.length - 1], ms = monthStart(L.t), me = monthEnd(L.t);
    const from = Math.max(L.t - 7 * DAY, pts[0].t);
    const d = delta(pts, from, L.t); if (!d || d.days < 0.5) return null;
    const left = (me - L.t) / DAY;
    // 범위: 최근 하루씩 증가 중 가장 적었던 날 ~ 가장 많았던 날 속도로 남은 기간을 채웠을 때
    const days = daily(pts, L.t - 8 * DAY, L.t).filter(x => !x.partial).slice(-7).map(x => x.v);
    const range = days.length >= 2 ? { lo: L.raw + Math.min(...days) * left, hi: L.raw + Math.max(...days) * left, loDay: Math.min(...days), hiDay: Math.max(...days), n: days.length } : null;
    return { now: L.raw, perDay: d.perDay, basisDays: d.days, left, value: L.raw + d.perDay * left, range, monthStart: ms, monthEnd: me, at: L.t };
  }
  // 목표까지: 남은 기간 동안 하루에 얼마씩 더 늘어야 하는지
  function goalPlan(fc, goal) {
    if (!fc || !(goal > 0)) return null;
    const need = Math.max(0, goal - fc.now), perDay = fc.left > 0.01 ? need / fc.left : Infinity;
    return { goal, need, perDay, pct: fc.now / goal, reached: fc.now >= goal, likely: fc.value >= goal, gap: goal - fc.value };
  }
  // 수익 효율: 대화 1천 개당 늘어난 정산 예상. 현금은 오리지널 작품 대화, 캐시는 나머지 작품 대화 기준
  function efficiency(snaps, from, to) {
    const last = snaps[snaps.length - 1]; if (!last) return null;
    const orig = last.works.filter(w => w.original).map(w => w.id), rest = last.works.filter(w => !w.original).map(w => w.id);
    const one = (key, ids) => {
      const ap = accountPoints(snaps, key), wp = workPoints(snaps, ids, 'msg');
      const a = delta(ap, from, to), b = delta(wp, from, to);
      const per = a && b && b.v > 50 ? a.v / b.v * 1000 : null;
      const ad = daily(ap, from, to), wd = daily(wp, from, to), byT = new Map(wd.map(x => [x.t, x]));
      const days = ad.map(x => { const m = byT.get(x.t); return { t: x.t, v: m && m.v > 50 && !x.partial ? x.v / m.v * 1000 : null, est: x.est, partial: x.partial }; }).filter(x => x.v != null);
      return { per, money: a ? a.v : null, msgs: b ? b.v : null, days };
    };
    return { money: one('expectedMoney', orig), cash: one('expectedCash', rest) };
  }
  // 작품별 수익 계획: 최근 7일 하루 평균 추정 수익과, 그 속도로 월말까지 더 늘 몫
  function workRevenue(ledger, fams, end, left) {
    const from = end - 7 * DAY, lf = ledgerFor(ledger, from, end);
    const first = ((ledger && ledger.entries) || []).reduce((m, e) => Math.min(m, parseId(e.from)), Infinity);
    const span = (end - Math.max(from, first)) / DAY;
    const mtd = ledgerFor(ledger, monthStart(end), end);
    return fams.map(f => {
      const pick = (L) => f.ids.reduce((s, id) => { const c = L.per[id]; return s + (c ? (f.original ? c[1] : c[0]) : 0); }, 0);
      const perDay = span > 0.5 ? pick(lf) / span : null;
      return { f, perDay, month: pick(mtd), rest: perDay != null ? perDay * left : null };
    });
  }
  // 월별 마지막 정산 예상 값
  function months(snaps) {
    const m = new Map();
    snaps.forEach(s => { if (!s.account) return; const k = monthKey(s.t); m.set(k, { month: k, t: s.t, id: s.id, cash: s.account.expectedCash, money: s.account.expectedMoney, superChat: s.account.monthlySuperChat }); });
    return [...m.values()];
  }


  // ---------- 오리지널 지원금 (작품당 한 번, 언세이프+세이프는 한 작품) ----------
  // 지급 달: 사용자가 정한 달 > 기록 중 오리지널이 된 것이 보인 달 > 생성 달
  function grants(snaps, cfg) {
    cfg = cfg || {};
    const amount = cfg.amount > 0 ? cfg.amount : 300000, months = cfg.months || {}, off = cfg.off || {}, dates = cfg.dates || {};
    const last = snaps[snaps.length - 1]; if (!last) return { list: [], amount };
    const fams = families(snaps, true).filter(f => f.original);
    const list = fams.map(f => {
      const ids = new Set(f.ids);
      let flip = null, seenBefore = false;
      for (const s of snaps) {
        const ws = s.works.filter(w => ids.has(w.id)); if (!ws.length) continue;
        const o = ws.some(w => w.original);
        if (!o) seenBefore = true; else if (seenBefore && !flip) flip = s.t;
      }
      const created = f.created || '', cm = dates[f.key] && dates[f.key].at ? Date.parse(dates[f.key].at) : null;
      // 내가 처음 단 댓글 시각 > 기록 중 오리지널이 된 시각 > 생성일
      const auto = cm ? monthKey(cm) : flip ? monthKey(flip) : created ? created.slice(0, 7) : monthKey(last.t);
      const src = cm ? 'comment' : flip ? 'flip' : 'created';
      return { key: f.key, name: f.name, created, flip, comment: cm ? { t: cm, text: dates[f.key].text } : null, checked: !!dates[f.key], denied: !!(dates[f.key] && dates[f.key].denied), src, auto, month: months[f.key] || auto, set: !!months[f.key], off: !!off[f.key] };
    }).sort((a, b) => (b.month).localeCompare(a.month) || a.name.localeCompare(b.name));
    const cur = monthKey(last.t), on = list.filter(g => !g.off);
    return { list, amount, included: !!cfg.included, cur,
      thisMonth: on.filter(g => g.month === cur).length * amount,
      total: on.filter(g => g.month <= cur).length * amount,
      upcoming: on.filter(g => g.month > cur).length * amount };
  }

  G.HH = { grants, goalPlan, efficiency, workRevenue, DAY, pad, idOf, parseId, dayStart, addDays, monthKey, monthStart, monthEnd, normSnap, normWork, parseImport, mergeSnaps, toFileSnap,
    interval, rebuildLedger, valueAt, workPoints, accountPoints, daily, families, PERIODS, periodRange, delta, momentum, ledgerFor, forecast, months, SAFE_RE };
})(typeof self !== 'undefined' ? self : this);
