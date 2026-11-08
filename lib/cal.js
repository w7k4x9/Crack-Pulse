// 펄스 달력 — 월간(색 진하기 + 주간 합계 + 날짜 상세)과 주간(지난주 같은 요일과 비교)
(function (G) {
  'use strict';
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const METRIC = {
    money: { label: '현금', unit: '원', col: 'money', name: '정산 예상 현금' },
    msg: { label: '대화', unit: '', col: 'msg', name: '대화' },
    like: { label: '좋아요', unit: '', col: 'like', name: '좋아요' },
  };
  let X = null; // 대시보드가 넘겨 주는 도구들

  const hexA = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const short = (v, unit) => { if (v == null || !isFinite(v)) return '–'; const s = v > 0 ? '+' : v < 0 ? '−' : ''; const a = Math.abs(v); return s + (a >= 1e5 ? (Math.round(a / 1e3) / 10).toLocaleString('ko-KR') + '만' : Math.round(a).toLocaleString('ko-KR')) + (unit || ''); };
  const sameDay = (a, b) => X.H.dayStart(a) === X.H.dayStart(b);
  const weekStart = t => { const d = new Date(X.H.dayStart(t)); d.setDate(d.getDate() - d.getDay()); return d.getTime(); };

  // ---------- 하루 단위 데이터 ----------
  let CACHE = null;
  function days() {
    const M = X.M; if (CACHE && CACHE.M === M) return CACHE;
    const map = new Map(), first = M.S[0].t, last = M.S[M.S.length - 1].t;
    const put = (k, arr) => arr.forEach(d => { const o = map.get(d.t) || { t: d.t }; o[k] = d.v; if (k === 'msg' || o.est == null) { o.est = d.est; o.partial = d.partial; o.cover = d.cover; } map.set(d.t, o); });
    put('money', X.H.daily(M.acct.money)); put('cash', X.H.daily(M.acct.cash));
    put('msg', X.H.daily(M.totals.msg)); put('like', X.H.daily(M.totals.like)); put('chat', X.H.daily(M.totals.chat));
    // 작품별 하루 대화 (그날 가장 많이 늘어난 작품)
    const fam = new Map();
    M.fams.forEach(f => X.H.daily(f.pts).forEach(d => { if (d.v > 0) { if (!fam.has(d.t)) fam.set(d.t, []); fam.get(d.t).push({ f, v: d.v }); } }));
    fam.forEach(l => l.sort((a, b) => b.v - a.v));
    // 그날 받은 기록 시각
    const shots = new Map(); M.S.forEach(s => { const k = X.H.dayStart(s.t); if (!shots.has(k)) shots.set(k, []); shots.get(k).push(s.t); });
    CACHE = { M, map, fam, shots, first, last };
    return CACHE;
  }
  const valOf = (d, k) => d && d[k] != null ? d[k] : null;

  // ---------- 상태 ----------
  function st() {
    const U = X.UI; U.cal = U.cal || {};
    const c = U.cal, D = days();
    if (!c.view) c.view = 'month';
    if (!METRIC[c.metric]) c.metric = 'money';
    const lo = X.H.dayStart(D.first), hi = X.H.dayStart(D.last);
    if (!c.sel || c.sel < X.H.addDays(lo, -40)) c.sel = hi; else if (c.sel > hi) c.sel = hi;
    return c;
  }

  // ---------- 툴바 ----------
  function tools(ctx) {
    if (ctx) X = ctx; const c = st();
    return X.seg('calview', [['month', '월'], ['week', '주']], c.view)
      + X.seg('calmetric', Object.entries(METRIC).map(([k, m]) => [k, m.label]), c.metric)
      + `<div class="calnav"><button class="tbtn icon" data-cal="prev" title="이전" aria-label="이전">‹</button><button class="tbtn" data-cal="today">오늘</button><button class="tbtn icon" data-cal="next" title="다음" aria-label="다음">›</button></div>`;
  }
  function title(ctx) {
    if (ctx) X = ctx; const c = st(), d = new Date(c.sel);
    if (c.view === 'month') return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
    const a = new Date(weekStart(c.sel)), b = new Date(X.H.addDays(a.getTime(), 6));
    return `${a.getMonth() + 1}월 ${a.getDate()}일 – ${a.getMonth() === b.getMonth() ? '' : b.getMonth() + 1 + '월 '}${b.getDate()}일`;
  }

  function sub(ctx) { if (ctx) X = ctx; return st().view === 'week' ? '지난주 같은 요일과 나란히 · 날짜를 누르면 그날 상세 · ← → 키로 하루씩' : '날짜를 누르면 그날 상세, 오른쪽 주간 칸을 누르면 그 주로 · ← → 키로 하루씩'; }

  // ---------- 월간 ----------
  function month() {
    const c = st(), D = days(), m = METRIC[c.metric], col = X.COL(m.col);
    const d0 = new Date(c.sel), y = d0.getFullYear(), mo = d0.getMonth();
    const ms = new Date(y, mo, 1).getTime(), me = new Date(y, mo + 1, 1).getTime();
    const gs = weekStart(ms), rows = Math.ceil((X.H.dayStart(me - 1) - gs) / 86400000 / 7 + 0.0001) || 5;
    const inMonth = []; for (let t = ms; t < me; t = X.H.addDays(t, 1)) { const d = D.map.get(t); if (d && valOf(d, c.metric) != null) inMonth.push(d); }
    const full = inMonth.filter(d => !d.partial), vals = full.map(d => Math.max(0, d[c.metric]));
    const max = Math.max(...vals, 0) || 1;
    // 요약
    const mk = `${y}-${String(mo + 1).padStart(2, '0')}`, fc = c.metric === 'money' ? X.M.fcMoney : null;
    const fcLine = fc && fc.cyc === mk && fc.left > 0.05 ? `<span class="sub small">월말 예상 <b class="num" style="font-size:inherit;font-weight:600">≈ ${short(fc.value, '원').replace('+', '')}</b></span>` : inMonth.length && inMonth.length < new Date(y, mo + 1, 0).getDate() ? `<span class="sub small">${inMonth.length}일치 기록</span>` : '';
    const tot = inMonth.reduce((s, d) => s + (d[c.metric] || 0), 0);
    const best = full.slice().sort((a, b) => b[c.metric] - a[c.metric])[0];
    const byWd = Array.from({ length: 7 }, () => []); full.forEach(d => byWd[new Date(d.t).getDay()].push(d[c.metric]));
    const wdAvg = byWd.map(a => a.length >= 2 ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const bestWd = wdAvg.reduce((bi, v, i) => v != null && (bi < 0 || v > wdAvg[bi]) ? i : bi, -1);
    const sum = `<div class="calsum">
      <div><span class="sub">${mo + 1}월 ${m.name}</span><b class="num">${short(tot, m.unit)}</b>${fcLine}</div>
      <div><span class="sub">하루 평균</span><b class="num">${full.length ? short(vals.reduce((s, v) => s + v, 0) / full.length, m.unit) : '–'}</b></div>
      <div><span class="sub">가장 좋았던 날</span><b>${best ? `${new Date(best.t).getDate()}일 (${WD[new Date(best.t).getDay()]})` : '–'}</b>${best ? `<span class="sub num small"> ${short(best[c.metric], m.unit)}</span>` : ''}</div>
      <div><span class="sub">강한 요일</span><b>${bestWd >= 0 ? WD[bestWd] + '요일' : '–'}</b>${bestWd >= 0 ? `<span class="sub small"> 평균 ${short(wdAvg[bestWd], m.unit)}</span>` : '<span class="faint small"> 2주 넘게 쌓이면 보여요</span>'}</div>
    </div>`;
    // 격자
    let g = `<div class="calgrid" role="grid" aria-label="${mo + 1}월 달력"><div class="cal-h">${WD.map((w, i) => `<div class="wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`).join('')}<div class="wd wk">주간</div></div>`;
    const today = X.H.dayStart(Date.now());
    const wsumOf = from => { let s2 = 0, n = 0; for (let i = 0; i < 7; i++) { const v = valOf(D.map.get(X.H.addDays(from, i)), c.metric); if (v != null) { s2 += v; n++; } } return n === 7 ? s2 : null; };
    let prevWeek = wsumOf(X.H.addDays(gs, -7));
    for (let r = 0; r < rows; r++) {
      g += '<div class="cal-r">';
      let wsum = 0, wn = 0, wpart = false;
      for (let i = 0; i < 7; i++) {
        const t = X.H.addDays(gs, r * 7 + i), d = D.map.get(t), out = t < ms || t >= me;
        const v = valOf(d, c.metric);
        if (v != null) { wsum += v; wn++; if (d.partial) wpart = true; }
        const fut = t > X.H.dayStart(D.last);
        const cls = ['cell', out ? 'out' : '', fut ? 'future' : '', t === today ? 'today' : '', t === X.H.dayStart(c.sel) ? 'sel' : '', d && d.est ? 'est' : '', d && d.partial ? 'part' : '', v == null ? 'nodata' : ''].filter(Boolean).join(' ');
        const other = d ? (c.metric === 'money' ? (d.msg != null ? `대화 ${short(d.msg)}` : '') : (d.money != null ? short(d.money, '원') : '')) : '';
        g += `<button class="${cls}" ${fut ? 'disabled tabindex="-1"' : `data-day="${t}"`} aria-label="${new Date(t).getMonth() + 1}월 ${new Date(t).getDate()}일 ${v != null ? short(v, m.unit) : '기록 없음'}">
          <span class="dn${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${new Date(t).getDate()}</span>
          ${v != null && !out ? `<span class="cv num">${short(v, m.unit)}</span><span class="co num">${other}</span>${d.est ? '<span class="tagx">추정</span>' : d.partial ? '<span class="tagx">진행 중</span>' : ''}` : ''}
        </button>`;
      }
      const ch = prevWeek != null && prevWeek > 0 && wn && !wpart ? wsum / prevWeek - 1 : null;
      g += `<div class="cell wk${wn ? '' : ' empty'}" ${wn ? `data-week="${X.H.addDays(gs, r * 7)}"` : ''}>${wn ? `<span class="cv num">${short(wsum, m.unit)}</span><span class="co">${wpart ? '진행 중' : ch == null ? `${wn}일` : `<span class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(ch * 100))}%</span> 지난주보다`}</span>` : '<span class="co faint">–</span>'}</div></div>`;
      if (wn) prevWeek = wn >= 7 ? wsum : null;
    }
    g += '</div>';
    const legend = `<div class="legend callegend"><span>'추정'은 그날 기록이 없어 앞뒤 기록으로 나눈 값 · '진행 중'은 아직 하루가 안 끝난 날</span></div>`;
    return sum + `<div class="cal-wrap"><div class="cal-main">${g}${legend}</div>${inspector()}</div>`;
  }

  // ---------- 날짜 상세 (오른쪽) ----------
  function inspector() {
    const c = st(), D = days(), t = X.H.dayStart(c.sel), d = D.map.get(t), dd = new Date(t);
    const head = `<div class="insp-h"><b>${dd.getMonth() + 1}월 ${dd.getDate()}일 ${WD[dd.getDay()]}요일</b>${d && d.est ? '<span class="tag ad">추정</span>' : d && d.partial ? '<span class="tag ad">진행 중</span>' : ''}</div>`;
    if (!d) return `<aside class="insp group">${head}<div class="sub small" style="padding:4px 14px 14px">이날은 기록이 없어요.</div></aside>`;
    // 이번 달 하루 평균과 비교
    const ms = new Date(dd.getFullYear(), dd.getMonth(), 1).getTime(), me = new Date(dd.getFullYear(), dd.getMonth() + 1, 1).getTime();
    const avg = k => { const a = []; D.map.forEach(x => { if (x.t >= ms && x.t < me && !x.partial && x[k] != null) a.push(x[k]); }); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; };
    const row = (k, lbl, unit) => { const v = d[k]; if (v == null) return ''; const a = avg(k), r = a ? v / a - 1 : null;
      return `<div class="insp-r"><span class="sub">${lbl}</span><span class="num"><b>${short(v, unit)}</b>${r != null && !d.partial && Math.abs(r) >= 0.05 ? ` <span class="small ${r >= 0 ? 'up' : 'down'}">${r >= 0 ? '▲' : '▼'}${Math.abs(Math.round(r * 100))}%</span>` : ''}</span></div>`; };
    const top = (D.fam.get(t) || []).slice(0, 5);
    const shots = D.shots.get(t) || [];
    return `<aside class="insp group">${head}
      <div class="insp-b">${row('money', '정산 예상 현금', '원')}${row('cash', '정산 예상 캐시', '')}${row('msg', '대화', '')}${row('like', '좋아요', '')}${row('chat', '새 대화방', '')}
      <div class="insp-note small faint">▲▼는 이달 하루 평균과 비교</div></div>
      ${top.length ? `<div class="insp-s">그날 많이 늘어난 작품</div>${top.map(x => `<div class="insp-w" data-fam="${X.esc(x.f.key)}"><span class="nm">${X.esc(x.f.name)}</span><span class="num sub">${short(x.v)}</span></div>`).join('')}` : ''}
      <div class="insp-s">이날 받은 기록</div><div class="insp-shots small">${shots.length ? shots.map(s => { const x = new Date(s); return `<span>${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}</span>`; }).join('') : '<span class="faint">없음 · 앞뒤 기록 사이를 고르게 나눈 값이에요</span>'}</div>
    </aside>`;
  }

  // ---------- 주간 ----------
  function week() {
    const c = st(), D = days(), m = METRIC[c.metric], col = X.COL(m.col);
    const ws = weekStart(c.sel), pws = X.H.addDays(ws, -7), today = X.H.dayStart(Date.now());
    const cur = [], prev = [];
    for (let i = 0; i < 7; i++) { cur.push(D.map.get(X.H.addDays(ws, i)) || { t: X.H.addDays(ws, i) }); prev.push(D.map.get(X.H.addDays(pws, i)) || { t: X.H.addDays(pws, i) }); }
    const max = Math.max(...cur.concat(prev).map(d => valOf(d, c.metric) || 0), 0) || 1;
    // 같은 요일까지 비교 (이번 주가 진행 중이면)
    const upto = cur.reduce((n, d, i) => valOf(d, c.metric) != null ? i + 1 : n, 0);
    const sumA = cur.slice(0, upto).reduce((s, d) => s + (valOf(d, c.metric) || 0), 0);
    // 비교는 하루가 끝난 날끼리만 (오늘처럼 진행 중인 날을 지난주 하루 전체와 비교하면 늘 떨어져 보여요)
    const done = cur.reduce((n, d, i) => valOf(d, c.metric) != null && !d.partial ? i + 1 : n, 0);
    const sumAd = cur.slice(0, done).reduce((s, d) => s + (valOf(d, c.metric) || 0), 0);
    const pv = prev.slice(0, done).filter(d => valOf(d, c.metric) != null), sumB = pv.reduce((s, d) => s + d[c.metric], 0);
    // 두 주 모두 하루가 온전히 기록된 요일끼리만 비교
    const pair = []; for (let i = 0; i < done; i++) if (valOf(cur[i], c.metric) != null && !cur[i].partial && valOf(prev[i], c.metric) != null && !prev[i].partial) pair.push(i);
    const pA = pair.reduce((s, i) => s + cur[i][c.metric], 0), pB = pair.reduce((s, i) => s + prev[i][c.metric], 0);
    const ch = pair.length && pB > 0 ? pA / pB - 1 : null;
    const head = `<div class="calsum">
      <div><span class="sub">이번 주 ${m.name}</span><b class="num">${upto ? short(sumA, m.unit) : '–'}</b>${upto && upto < 7 ? `<span class="sub small">${upto > done ? '오늘 진행 중 포함' : WD[upto - 1] + '요일까지'}</span>` : ''}</div>
      <div><span class="sub">지난주 같은 요일</span><b class="num">${pair.length ? short(pB, m.unit) : pv.length ? short(sumB, m.unit) : '–'}</b>${pair.length ? `<span class="sub small">${pair.length === 7 ? '일~토 전체' : pair.map(i => WD[i]).join('·')}${pair.length < upto ? ` · 이번 주 같은 날 ${short(pA, m.unit)}` : ''}</span>` : ''}</div>
      <div><span class="sub">변화</span><b class="${ch == null || Math.abs(ch) < 0.01 ? '' : ch >= 0 ? 'up' : 'down'}">${ch == null ? '–' : Math.abs(ch) < 0.01 ? '비슷해요' : `${ch >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(ch * 100))}%`}</b>${ch == null ? `<span class="faint small">${done ? '지난주 기록이 부족해요' : '하루가 끝나면 비교해요'}</span>` : pair.length < 7 ? `<span class="sub small">같은 요일 ${pair.length}일끼리 비교</span>` : ''}</div>
      <div><span class="sub">하루 평균</span><b class="num">${done ? short(sumAd / done, m.unit) : '–'}</b>${done ? `<span class="sub small">끝난 날 기준</span>` : ''}</div>
    </div>`;
    const cols = cur.map((d, i) => {
      const v = valOf(d, c.metric), p = valOf(prev[i], c.metric), dt = new Date(d.t), future = d.t > today;
      const top = (D.fam.get(d.t) || [])[0];
      const r = v != null && p > 0 && !prev[i].partial ? v / p - 1 : null;
      return `<button class="wcol${d.t === today ? ' today' : ''}${d.t === X.H.dayStart(c.sel) ? ' sel' : ''}${future ? ' future' : ''}" ${future ? 'disabled tabindex="-1"' : `data-day="${d.t}"`}>
        <div class="wh"><span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${WD[i]}</span><span class="wdn">${dt.getDate()}</span></div>
        <div class="wv num">${v != null ? short(v, m.unit) : future ? '' : '–'}</div>
        <div class="wr small">${r != null && !d.partial ? Math.abs(r) < 0.005 ? '<span class="faint">±0%</span>' : `<span class="${r >= 0 ? 'up' : 'down'}">${r >= 0 ? '▲' : '▼'}${Math.abs(Math.round(r * 100))}%</span>` : d.partial ? '<span class="faint">진행 중</span>' : d.est ? '<span class="faint">추정</span>' : '&nbsp;'}</div>
        <div class="wbars" aria-hidden="true"><i class="pb" style="height:${p != null ? Math.max(2, p / max * 100) : 0}%"></i><i style="height:${v != null ? Math.max(2, v / max * 100) : 0}%;background:${col}${d.partial ? ';opacity:.5' : ''}"></i></div>
        <div class="wf small">${p != null ? `<span>지난주</span><span class="num">${short(p, m.unit)}</span>` : '&nbsp;'}</div>
        <div class="wt small">${top ? X.esc(top.f.name) : '&nbsp;'}</div>
      </button>`;
    }).join('');
    // 이번 주 작품 (대화 증가)
    const sumFam = (from, n) => { const m2 = new Map(); for (let i = 0; i < n; i++) (D.fam.get(X.H.addDays(from, i)) || []).forEach(x => m2.set(x.f.key, { f: x.f, v: (m2.get(x.f.key) || { v: 0 }).v + x.v })); return m2; };
    const a = sumFam(ws, done || upto || 7), b = sumFam(pws, done || upto || 7);
    const rows = [...a.values()].sort((x, y) => y.v - x.v).slice(0, 8);
    const works = rows.length ? `<div class="sec-h"><h2>이번 주 작품</h2><span class="sub">대화 증가 · ${done && done < 7 ? `끝난 ${done}일` : done ? '일~토' : '오늘'} 기준, 지난주 같은 기간과 비교</span></div><div class="group">${rows.map(x => { const pb = b.get(x.f.key), r = pb && pb.v > 30 ? x.v / pb.v - 1 : null;
      return `<div class="group-row" data-fam="${X.esc(x.f.key)}" style="cursor:default"><div class="grow"><b style="font-weight:500">${X.esc(x.f.name)}</b></div><span class="num">${short(x.v)}</span><span class="num sub small" style="width:90px;text-align:right">${pb ? '지난주 ' + short(pb.v) : '지난주 –'}</span><span class="small" style="width:56px;text-align:right">${r == null ? '<span class="faint">–</span>' : `<span class="${r >= 0 ? 'up' : 'down'}">${r >= 0 ? '▲' : '▼'}${Math.abs(Math.round(r * 100))}%</span>`}</span></div>`; }).join('')}</div>` : '';
    return head + `<div class="cal-wrap"><div class="cal-main"><div class="wgrid">${cols}</div><div class="legend callegend"><span><i class="lg-pb"></i>지난주 같은 요일</span><span><span class="sw" style="background:${col}"></span>이번 주</span><span>맨 아래는 그날 대화가 가장 많이 늘어난 작품</span></div>${works}</div>${inspector()}</div>`;
  }

  // ---------- 진입점 ----------
  function page(ctx) { X = ctx; CACHE = null; const c = st(); return c.view === 'week' ? week() : month(); }
  function onClick(ctx, t) {
    X = ctx; const c = st();
    const nav = t.closest('[data-cal]');
    if (nav) {
      const a = nav.dataset.cal, d = new Date(c.sel);
      if (a === 'today') c.sel = X.H.dayStart(Date.now());
      else if (c.view === 'month') { d.setDate(1); d.setMonth(d.getMonth() + (a === 'next' ? 1 : -1)); c.sel = d.getTime(); }
      else c.sel = X.H.addDays(c.sel, a === 'next' ? 7 : -7);
      return true;
    }
    const day = t.closest('[data-day]');
    // 날짜를 누르면 오른쪽에 그날 상세 (월간의 '주간' 칸은 그 주로)
    if (day) { c.sel = +day.dataset.day; return true; }
    const wk = t.closest('[data-week]');
    if (wk) { c.sel = +wk.dataset.week; c.view = 'week'; return true; }
    return false;
  }
  function move(ctx, days) { X = ctx; const c = st(); c.sel = X.H.addDays(X.H.dayStart(c.sel), days); }
  G.PulseCal = { page, tools, title, sub, onClick, move, METRIC };
})(window);
