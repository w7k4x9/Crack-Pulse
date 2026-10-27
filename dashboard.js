// 펄스 대시보드
(function () {
  'use strict';
  const H = window.HH, C = window.HC, esc = C.esc, DAY = H.DAY;
  const $ = s => document.querySelector(s);
  const fmt = n => n == null || !isFinite(n) ? '–' : Math.round(n).toLocaleString('ko-KR');
  const sfmt = n => n == null || !isFinite(n) ? '–' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR');
  const won = n => fmt(n) + '원';
  const ago = t => { if (!t) return '없음'; const m = (Date.now() - t) / 60000; if (m < 1) return '방금'; if (m < 60) return Math.floor(m) + '분 전'; if (m < 1440) return Math.floor(m / 60) + '시간 전'; return Math.floor(m / 1440) + '일 전'; };
  const COL = k => getComputedStyle(document.documentElement).getPropertyValue('--s-' + k).trim();
  const METRICS = { msg: '대화', like: '좋아요', comment: '댓글', chat: '대화방' };

  // ---------- 상태 ----------
  let DATA = { snaps: [], ledger: null, settings: { auto: 0, theme: 'system' }, meta: {} };
  let STATUS = { run: { busy: false }, loggedIn: null, meta: {}, lock: null };
  const UI = Object.assign({ page: 'overview', period: '7d', metric: 'msg', dview: 'day', group: true, vis: 'public', q: '', sortKey: 'inc', sortDir: -1, dMetric: 'msg' }, (() => { try { return JSON.parse(localStorage.getItem('hh_ui') || '{}'); } catch (e) { return {}; } })());
  const saveUI = () => { try { const { page, sheet, q, ...keep } = UI; localStorage.setItem('hh_ui', JSON.stringify(keep)); } catch (e) {} };
  let SHEET = null; // 열려 있는 작품 key

  const hasChrome = !!(window.chrome && chrome.storage && chrome.storage.local);
  const send = msg => hasChrome && chrome.runtime && chrome.runtime.sendMessage ? chrome.runtime.sendMessage(msg) : Promise.resolve(null);

  async function load() {
    const o = await chrome.storage.local.get(['snaps', 'ledger', 'settings', 'meta']);
    DATA.snaps = (o.snaps || []).slice().sort((a, b) => a.t - b.t);
    DATA.ledger = o.ledger || null;
    DATA.settings = Object.assign({ auto: 0, theme: 'system' }, o.settings || {});
    DATA.meta = o.meta || {};
    window.hhApplyTheme(DATA.settings.theme);
  }
  let UPD = null;
  async function refreshStatus() { try { const s = await send({ type: 'status' }); if (s) STATUS = s; } catch (e) {} try { UPD = await send({ type: 'updateStatus' }); } catch (e) {} drawSide(); }

  // ---------- 계산 ----------
  let MODEL = null;
  function build() {
    const S = DATA.snaps, R = H.periodRange(S, UI.period);
    if (!S.length) return { S, R: null, fams: [] };
    const allIds = S[S.length - 1].works.map(w => w.id);
    // 하루 단위 그래프는 기간이 짧아도 최소 14일(목록 안 막대는 7일)을 보여 줌
    R.view = Math.min(R.start, R.end - 14 * DAY); R.spark = Math.min(R.start, R.end - 7 * DAY);
    const lf = H.ledgerFor(DATA.ledger, R.start, R.end), lfAll = H.ledgerFor(DATA.ledger, 0, Infinity);
    const fams = H.families(S, UI.group).map(f => {
      const last = {}; ['msg', 'like', 'comment', 'chat'].forEach(k => last[k] = f.members.reduce((s, w) => s + (w[k] || 0), 0));
      const pts = H.workPoints(S, f.ids, 'msg');
      const d = H.delta(pts, R.start, R.end);
      const dl = k => { const x = H.delta(H.workPoints(S, f.ids, k), R.start, R.end); return x ? x.v : null; };
      const rev = f.ids.reduce((a, id) => { const c = lf.per[id]; if (c) { a[0] += c[0]; a[1] += c[1]; } return a; }, [0, 0]);
      const revAll = f.ids.reduce((a, id) => { const c = lfAll.per[id]; if (c) { a[0] += c[0]; a[1] += c[1]; } return a; }, [0, 0]);
      return Object.assign(f, { last, pts, inc: d ? d.v : null, perDay: d ? d.perDay : null, mom: H.momentum(pts, R),
        spark: H.daily(pts, R.spark, R.end), dLike: dl('like'), dComment: dl('comment'), dChat: dl('chat'),
        rev: f.original ? rev[1] : rev[0], revAll: f.original ? revAll[1] : revAll[0], unit: f.original ? '원' : '캐시',
        rroom: last.chat ? last.msg / last.chat : null });
    });
    const totals = {};
    ['msg', 'like', 'comment', 'chat'].forEach(k => { totals[k] = H.workPoints(S, allIds, k); });
    const acct = { money: H.accountPoints(S, 'expectedMoney'), cash: H.accountPoints(S, 'expectedCash') };
    return { S, R, fams, totals, acct, lf, fcMoney: H.forecast(S, 'expectedMoney'), fcCash: H.forecast(S, 'expectedCash') };
  }
  function seriesFor(key, R) {
    const M = MODEL;
    if (key === 'money') return M.acct.money; if (key === 'cash') return M.acct.cash;
    return M.totals[key];
  }
  const visFilter = f => (UI.vis === 'all' || f.visibility === 'public') && (!UI.q || f.name.toLowerCase().includes(UI.q.toLowerCase()) || f.members.some(m => m.name.toLowerCase().includes(UI.q.toLowerCase())));

  // ---------- 공통 조각 ----------
  const tagsOf = f => [f.original ? '<span class="tag or">오리지널</span>' : '', f.only ? '<span class="tag on">온리</span>' : '', f.visibility === 'linkonly' ? '<span class="tag lk">링크 공개</span>' : f.visibility === 'private' ? '<span class="tag ad">비공개</span>' : '',
    f.hasSafe && f.hasUnsafe ? '' : f.hasUnsafe ? `<span class="tag ad">${UI.group ? '언세이프만' : '언세이프'}</span>` : `<span class="tag ad">${UI.group ? '세이프만' : '세이프'}</span>`].join('');
  const momHtml = o => { if (!o) return '<span class="faint">–</span>'; const m = o.v; return Math.abs(m) < 0.03 ? '<span class="sub">비슷</span>' : m > 0 ? `<span class="up">▲ ${Math.round(m * 100)}%</span>` : `<span class="down">▼ ${Math.round(-m * 100)}%</span>`; };
  const momTitle = o => !o ? '기록이 짧거나 대화가 적어서 비교하지 않았어요' : `${o.mode === 'prev' ? `하루 평균 대화가 바로 앞 ${H.PERIODS[UI.period].label}보다` : '기간 후반의 하루 평균 대화가 전반보다'} ${Math.abs(Math.round(o.v * 100))}% ${o.v >= 0 ? '많아요' : '적어요'}`;
  const revHtml = f => f.rev > 0.5 ? `≈ ${fmt(f.rev)}<span class="sub small">${f.unit}</span>` : '<span class="faint">–</span>';
  const seg = (name, opts, cur) => `<div class="seg" role="group" data-seg="${name}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}" aria-pressed="${String(cur) === String(v)}">${t}</button>`).join('')}</div>`;
  const periodSeg = () => seg('period', Object.entries(H.PERIODS).map(([k, p]) => [k, p.label]), UI.period);
  function periodSub() {
    const R = MODEL.R; if (!R) return '';
    const a = C.tlong(R.start), b = C.tlong(R.end);
    return `${a} → ${b}` + (R.short ? ` · 기록이 ${R.days < 1 ? Math.round(R.days * 24) + '시간' : (Math.round(R.days * 10) / 10) + '일'}치뿐이라 그만큼만 계산했어요` : '');
  }

  // ---------- 사이드바 상태 ----------
  function drawSide() {
    const m = STATUS.meta || DATA.meta || {}, run = STATUS.run || {};
    const auto = DATA.settings.auto;
    const L = STATUS.lock;
    let btn = '스냅샷 받기';
    if (run.busy) btn = '받는 중…'; else if (L && L.hard) btn = `쉬는 중 (${Math.ceil(L.ms / 60000)}분)`;
    $('#sideStatus').innerHTML = (UPD && UPD.available ? `<button class="btn" id="sUpd" style="justify-content:flex-start;gap:7px;color:var(--accent)"><span class="dot" style="background:var(--accent)"></span>새 버전 ${esc(UPD.latest)} 업데이트</button>` : '') + `
      <button class="st link-like" id="sLogin" style="background:none;border:0;cursor:pointer;text-align:left" title="${STATUS.loggedIn ? '크랙에 로그인되어 있어요' : '눌러서 크랙 열기'}"><span class="dot ${STATUS.loggedIn == null ? 'idle' : STATUS.loggedIn ? 'ok' : 'no'}"></span>${STATUS.loggedIn == null ? '확인 중' : STATUS.loggedIn ? '크랙 로그인됨' : '크랙 로그인 필요'}</button>
      <div class="st"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7"/><path d="M10 6v4.3l2.8 1.8"/></svg>마지막 기록 ${ago(m.lastTaken || (DATA.snaps.length ? DATA.snaps[DATA.snaps.length - 1].t : 0))}</div>
      <div class="st"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 10a6 6 0 0 1 10.2-4.3L16 7.5M16 3.5v4h-4M16 10a6 6 0 0 1-10.2 4.3L4 12.5M4 16.5v-4h4"/></svg>자동 ${auto ? '하루 ' + auto + '번' : '꺼짐'}</div>
      ${run.busy ? `<div class="prog">${esc(run.text || '')}</div>` : ''}
      ${m.lastError ? `<div class="err">${esc(m.lastError.text)}</div>` : ''}
      <button class="btn primary big" id="sSnap" ${run.busy || (L && L.hard) ? 'disabled' : ''}>${btn}</button>`;
    $('#sLogin').onclick = () => send({ type: 'openCrack' });
    $('#sSnap').onclick = snapshot;
    const su = $('#sUpd'); if (su) su.onclick = () => send({ type: 'openUpdate' });
  }

  async function snapshot() {
    if (!hasChrome) return;
    let r = await send({ type: 'snapshot' });
    if (r && r.needConfirm) {
      if (!(await dialog('지금 받을까요?', `마지막 기록에서 30분이 안 지났어요 (${r.waitMin}분 남음). 너무 자주 받으면 크랙이 요청을 막을 수 있어요.`, '그래도 받기'))) return;
      r = await send({ type: 'snapshot', force: true });
    }
    await refreshStatus();
    if (!r) return;
    if (r.ok) toast(`기록 저장됨 · 작품 ${r.count}개` + (r.account ? '' : ` · 정산 정보는 받지 못함 (${r.accountWhy || '이유 모름'})`));
    else if (r.login) { if (await dialog('크랙 로그인이 필요해요', '크랙을 열어 로그인한 뒤 다시 눌러 주세요. 로그인 정보는 브라우저에 있는 그대로 써요.', '크랙 열기')) send({ type: 'openCrack' }); }
    else if (r.error) dialog('스냅샷을 받지 못했어요', r.error, '확인', true);
  }

  // ---------- 페이지: 개요 ----------
  const goalOf = kind => { const g = (DATA.settings.goals || {})[H.monthKey(MODEL.S[MODEL.S.length - 1].t) + ':' + kind]; return g > 0 ? g : null; };
  const man = v => Math.abs(v) >= 1e4 ? (Math.round(v / 1e3) / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '만' : fmt(v);
  const left = d => d < 1 ? Math.max(1, Math.round(d * 24)) + '시간' : (Math.round(d * 10) / 10) + '일';
  function heroPanel(kind) {
    const M = MODEL, money = kind === 'money', fc = money ? M.fcMoney : M.fcCash;
    const pts = (money ? M.acct.money : M.acct.cash).filter(p => H.monthKey(p.t) === H.monthKey(M.S[M.S.length - 1].t)).map(p => ({ t: p.t, v: p.raw, id: p.id }));
    const last = pts[pts.length - 1], unit = money ? '원' : '캐시';
    const other = money ? M.acct.cash : M.acct.money, ofc = money ? M.fcCash : M.fcMoney;
    const mName = new Date(M.S[M.S.length - 1].t).getMonth() + 1;
    const goal = goalOf(kind), plan = H.goalPlan(fc, goal);
    let goalHtml = '';
    if (plan) {
      const st = plan.reached ? `<span class="up">✓ 목표를 넘었어요</span>`
        : plan.likely ? `<span class="up">✓ 지금 속도면 달성해요</span> <span class="sub">(하루 ${sfmt(plan.perDay)}${unit}만 늘면 돼요)</span>`
        : `<span class="down">! 지금 속도면 ${fmt(plan.gap)}${unit} 모자라요</span> <span class="sub">— 하루 ${sfmt(plan.perDay)}${unit}씩 늘어야 해요</span>`;
      goalHtml = `<div class="goal"><div class="goal-top"><span>목표 <b class="num">${fmt(goal)}${unit}</b> 중 <b class="num">${Math.floor(plan.pct * 100)}%</b></span><button class="link small" data-goal="${kind}">바꾸기</button></div>
        <div class="gbar" role="img" aria-label="목표의 ${Math.floor(plan.pct * 100)}%"><div style="width:${Math.min(100, plan.pct * 100).toFixed(1)}%"></div>${fc ? `<i style="left:${Math.min(100, fc.value / goal * 100).toFixed(1)}%" title="월말 예상"></i>` : ''}</div>
        <div class="small goal-st">${st}</div></div>`;
    } else if (fc) goalHtml = `<button class="btn goal-set" data-goal="${kind}">이번 달 목표 정하기</button>`;
    return `<div class="group hero">
      <div class="hero-num">
        <div class="lbl"><span class="sw" style="background:var(--s-${kind});margin-right:6px"></span>${mName}월 정산 예상 ${money ? '현금' : '캐시'}</div>
        <div class="big num">${last ? fmt(last.v) : '–'}<small>${unit}</small></div>
        ${goalHtml}
        ${fc ? `<dl class="fc">
          <dt>월말 예상</dt><dd class="num">≈ ${fmt(fc.value)}${unit}</dd>
          ${fc.range ? `<dt title="최근 ${fc.range.n}일 중 가장 적게 늘었던 날과 가장 많이 늘었던 날의 속도로 남은 기간을 채웠을 때">예상 범위</dt><dd class="num sub">${man(fc.range.lo)} ~ ${man(fc.range.hi)}</dd>` : ''}
          <dt>하루 평균</dt><dd class="num">${sfmt(fc.perDay)}${unit}</dd>
          <dt>남은 기간</dt><dd class="num">${left(fc.left)}</dd>
        </dl><div class="sub small" style="margin-top:6px">하루 평균은 최근 ${fc.basisDays < 6.5 ? (Math.round(fc.basisDays * 10) / 10) + '일' : '7일'} 기준이에요</div>` : '<div class="sub small" style="margin-top:8px">정산 정보가 담긴 기록이 두 개 이상 쌓이면 월말 예상이 나와요.</div>'}
        ${kind === 'money' && other.length ? `<div class="cash"><span class="sub"><span class="sw" style="background:var(--s-cash);margin-right:6px"></span>정산 예상 캐시</span><span class="num"><b>${fmt(other[other.length - 1].raw)}</b>${ofc ? ` <span class="sub">${sfmt(ofc.perDay)}/일</span>` : ''}</span></div>` : ''}
      </div>
      <div class="hero-chart"><div class="cap"><span>이번 달 누적</span><span>점선은 지금 속도, 옅은 부채꼴은 예상 범위${goal ? ', 가로 점선은 목표' : ''}</span></div><div class="chart" data-chart="month-${kind}"></div></div>
    </div>`;
  }
  function drawHeroCharts() {
    const M = MODEL;
    ['money', 'cash'].forEach(kind => {
      const el = document.querySelector(`[data-chart="month-${kind}"]`); if (!el) return;
      const pts = (kind === 'money' ? M.acct.money : M.acct.cash).filter(p => H.monthKey(p.t) === H.monthKey(M.S[M.S.length - 1].t)).map(p => ({ t: p.t, v: p.raw, id: p.id }));
      C.month(el, { pts, fc: kind === 'money' ? M.fcMoney : M.fcCash, goal: goalOf(kind), color: COL(kind), fmt: n => fmt(n) + (kind === 'money' ? '원' : '캐시'), label: kind === 'money' ? '정산 예상 현금' : '정산 예상 캐시' });
    });
  }

  function pageOverview() {
    const M = MODEL, R = M.R;
    const tile = (key, label, unit) => {
      const pts = seriesFor(key), d = H.delta(pts, R.start, R.end);
      return `<div class="tile"><div class="lbl"><span class="sw" style="background:var(--s-${key})"></span>${label}</div><div class="v num">${d ? sfmt(d.v) : '–'}<span class="sub" style="font-size:13px;font-weight:500">${unit}</span></div><div class="s num">${d ? `하루 평균 ${sfmt(d.perDay)}${unit}` : '기록이 더 필요해요'}</div></div>`;
    };
    const list = M.fams.filter(visFilter).filter(f => f.inc != null).sort((a, b) => (b.inc || 0) - (a.inc || 0));
    const top = list.slice(0, 8);
    return heroPanel('money') +
      `<div class="sec-h"><h2>${H.PERIODS[UI.period].label} 동안 늘어난 것</h2><span class="sub">모든 작품 합계</span></div>
      <div class="group tiles">${tile('msg', '대화', '')}${tile('money', '정산 예상 현금', '원')}${tile('cash', '정산 예상 캐시', '')}${tile('like', '좋아요', '')}</div>
      <div class="sec-h"><h2>추이</h2>${seg('metric', [['msg', '대화'], ['money', '현금'], ['cash', '캐시'], ['like', '좋아요'], ['comment', '댓글'], ['chat', '대화방']], UI.metric)}</div>
      <div class="group chart-panel"><div class="chart-top"><span style="display:flex;align-items:center;gap:12px">${seg('dview', [['day', '하루씩'], ['rate', '시간당']], UI.dview)}<span class="t" id="dTitle"></span></span><span class="legend" id="dLegend"></span></div><div class="chart" data-chart="daily"></div></div>
      <div class="sec-h"><h2>작품 흐름</h2><span class="sub">${UI.vis === 'public' ? '공개 작품 · ' : ''}대화 증가 순</span></div>
      <div class="group rank">
        <div class="r h"><span></span><span>작품</span><span class="c">하루 평균 대화</span><span class="c">하루씩</span><span class="c" title="바로 앞의 같은 기간과 비교 (기록이 모자라면 기간 후반 vs 전반)">변화</span><span class="c">좋아요</span><span class="c">추정 수익</span></div>
        ${top.length ? top.map((f, i) => rankRow(f, i)).join('') : '<div class="r" style="cursor:default"><span></span><span class="sub">이 기간에 늘어난 작품이 없어요</span></div>'}
        ${list.length > top.length ? `<div class="more"><a class="link" href="#works">작품 ${list.length}개 모두 보기</a></div>` : ''}
      </div>`;
  }
  function rankRow(f, i) {
    return `<div class="r" data-fam="${esc(f.key)}" tabindex="0"><span class="no">${i + 1}</span>
      <span class="nm"><b>${esc(f.name)}</b><span class="tags">${tagsOf(f)}</span></span>
      <span class="c num"><b>${sfmt(f.perDay)}</b><div class="s">${H.PERIODS[UI.period].label} ${sfmt(f.inc)}</div></span>
      <span class="c">${C.spark(f.spark, COL('msg'))}</span>
      <span class="c small" title="${momTitle(f.mom)}">${momHtml(f.mom)}</span>
      <span class="c num">${f.dLike ? sfmt(f.dLike) : '<span class="faint">0</span>'}</span>
      <span class="c num">${revHtml(f)}</span></div>`;
  }
  function drawDaily() {
    const el = document.querySelector('[data-chart="daily"]'); if (!el) return;
    const M = MODEL, k = UI.metric, pts = seriesFor(k), col = COL(k);
    const unit = k === 'money' ? '원' : '';
    const names = { msg: '대화', money: '정산 예상 현금', cash: '정산 예상 캐시', like: '좋아요', comment: '댓글', chat: '대화방' };
    if (UI.dview === 'rate') {
      $('#dTitle').textContent = `기록 사이 시간당 ${names[k]}`;
      $('#dLegend').innerHTML = `<span><span class="sw" style="background:${col}"></span>칸 너비 = 기록 사이 시간</span><span><span class="sw" style="background:${col};opacity:.55"></span>30시간 넘게 비어 있던 구간</span>`;
      C.steps(el, { pts, from: M.R.view, color: col, fmt: n => sfmt(n) + unit, aria: `기록 사이 시간당 ${names[k]}` });
      return;
    }
    $('#dTitle').textContent = `하루 ${names[k]} ${k === 'chat' ? '증가' : k === 'msg' ? '수' : '증가'}`;
    $('#dLegend').innerHTML = `<span><span class="sw" style="background:${col}"></span>기록 사이 증가</span><span><span class="hatch"></span>그날 기록 없음 (추정)</span><span><span class="sw" style="background:${col};opacity:.5"></span>하루가 다 안 찬 날</span>`;
    C.bars(el, { layers: [{ label: names[k], color: col, data: H.daily(pts, M.R.view, M.R.end) }], fmt: n => sfmt(n) + unit, aria: `하루 ${names[k]}` });
  }

  // ---------- 페이지: 작품 ----------
  const COLS = [
    ['name', '작품', 'l'], ['msg', '총 대화'], ['inc', '대화 증가'], ['perDay', '하루 평균'], ['spark', '하루씩', '', true], ['mom', '변화'], ['rev', '추정 수익'], ['like', '좋아요'], ['chat', '대화방'], ['rroom', '방당 대화'], ['created', '생성일'],
  ];
  function sortVal(f, k) { if (k === 'mom') return f.mom ? f.mom.v : null; return k === 'msg' || k === 'like' || k === 'chat' ? f.last[k] : f[k]; }
  function pageWorks() {
    const rows = MODEL.fams.filter(visFilter);
    const k = UI.sortKey, dir = UI.sortDir;
    rows.sort((a, b) => { const x = sortVal(a, k), y = sortVal(b, k); if (typeof x === 'string' || typeof y === 'string') return String(x || '').localeCompare(String(y || '')) * dir; return ((x ?? -Infinity) - (y ?? -Infinity)) * dir || (b.last.msg - a.last.msg); });
    return `<div class="group table-wrap"><table class="tbl"><thead><tr>${COLS.map(([key, t, cls, nosort]) => `<th class="${cls || ''} ${UI.sortKey === key ? 'sorted' + (UI.sortDir > 0 ? ' asc' : '') : ''}" ${nosort ? '' : `data-sort="${key}"`}>${t}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(f => `<tr data-fam="${esc(f.key)}" class="${f.inc ? '' : 'dim'}"><td class="l nm"><b>${esc(f.name)}</b><span class="tags">${tagsOf(f)}</span></td>
        <td class="num">${fmt(f.last.msg)}</td><td class="num">${f.inc ? sfmt(f.inc) : '<span class="faint">0</span>'}</td><td class="num">${f.perDay ? sfmt(f.perDay) : '<span class="faint">–</span>'}</td>
        <td>${C.spark(f.spark, COL('msg'), 72, 18)}</td><td class="small" title="${momTitle(f.mom)}">${momHtml(f.mom)}</td><td class="num">${revHtml(f)}</td>
        <td class="num">${fmt(f.last.like)}${f.dLike ? ` <span class="up small">${sfmt(f.dLike)}</span>` : ''}</td><td class="num">${fmt(f.last.chat)}${f.dChat ? ` <span class="up small">${sfmt(f.dChat)}</span>` : ''}</td>
        <td class="num">${f.rroom ? f.rroom.toFixed(1) : '–'}</td><td class="sub num">${esc(f.created)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">${rows.length}개 · 증가와 추정 수익은 위에서 고른 기간 기준이에요. 추정 수익은 계정 정산 증가분을 작품별 대화 증가 비율로 나눈 값이라 실제 정산과 다를 수 있어요 (오리지널은 현금, 나머지는 캐시).</p>`;
  }

  // ---------- 페이지: 수익 ----------
  function pageRevenue() {
    const M = MODEL, R = M.R, fc = M.fcMoney;
    const eff = H.efficiency(M.S, R.start, R.end);
    const plan = H.workRevenue(DATA.ledger, M.fams, R.end, fc ? fc.left : 0).filter(x => x.perDay > 0.5 || x.month > 0.5);
    const firstLedger = ((DATA.ledger && DATA.ledger.entries) || [])[0];
    const since = firstLedger && H.monthKey(H.parseId(firstLedger.from)) === H.monthKey(R.end) && H.parseId(firstLedger.from) - H.monthStart(R.end) > H.DAY ? C.dlabel(H.parseId(firstLedger.from)) : null;
    const planRows = (orig, unit, key) => {
      const rows = plan.filter(x => !!x.f.original === orig).sort((a, b) => (b.perDay || 0) - (a.perDay || 0)); if (!rows.length) return '';
      const tot = rows.reduce((s, x) => s + (x.perDay || 0), 0);
      return `<tr class="grp"><td class="l" colspan="5"><span class="sw" style="background:var(--s-${key});margin-right:6px"></span>${orig ? '현금 · 오리지널 작품' : '캐시 · 그 밖의 작품'}</td></tr>` + rows.map(x => {
        const sh = tot ? (x.perDay || 0) / tot : 0;
        return `<tr data-fam="${esc(x.f.key)}"><td class="l nm"><b>${esc(x.f.name)}</b></td><td class="num"><b>${x.perDay != null ? '≈ ' + fmt(x.perDay) : '–'}</b><span class="sub small">${unit}</span></td><td class="share"><span class="sbar"><span style="width:${(sh * 100).toFixed(1)}%;background:var(--s-${key})"></span></span><span class="num small">${Math.round(sh * 100)}%</span></td><td class="num">${fmt(x.month)}<span class="sub small">${unit}</span></td><td class="num">${x.rest != null ? '+' + fmt(x.rest) : '–'}<span class="sub small">${unit}</span></td></tr>`;
      }).join('');
    };
    const effTile = (o, label, unit, basis) => `<div class="tile"><div class="lbl">${label}</div><div class="v num">${o.per != null ? '≈ ' + fmt(o.per) : '–'}<span class="sub" style="font-size:13px;font-weight:500">${unit}</span></div><div class="s num">${o.per != null ? `${basis} 대화 ${fmt(o.msgs)}개에 ${sfmt(o.money)}${unit}` : '대화가 더 쌓이면 계산돼요'}</div></div>`;
    const ifTile = eff.money.per != null ? `<div class="tile"><div class="lbl">오리지널 대화가 하루 1만 개 더 늘면</div><div class="v num">≈ +${fmt(eff.money.per * 10)}<span class="sub" style="font-size:13px;font-weight:500">원/일</span></div><div class="s">한 달이면 ≈ ${C.kfmt(eff.money.per * 10 * 30)}원</div></div>` : '';
    const months = H.months(M.S).reverse();
    const E = ((DATA.ledger && DATA.ledger.entries) || []).slice().reverse();
    return heroPanel('money') +
      `<div class="sec-h"><h2>하루 정산 예상 현금</h2><span class="sub">가로 점선은 기간 평균</span></div>
      <div class="group chart-panel"><div class="chart" data-chart="rev-daily"></div></div>
      <div class="sec-h"><h2>수익 효율</h2><span class="sub">${H.PERIODS[UI.period].label} 동안 대화 1천 개가 정산 예상을 얼마나 올렸는지</span></div>
      <div class="group tiles tiles-3">${effTile(eff.money, '대화 1천 개당 현금', '원', '오리지널')}${effTile(eff.cash, '대화 1천 개당 캐시', '캐시', '그 밖의 작품')}${ifTile}</div>
      ${eff.money.days.length >= 2 ? `<div class="group chart-panel" style="margin-top:10px"><div class="chart-top"><span class="t">날마다 대화 1천 개당 현금</span><span class="legend"><span>높은 날 = 대화량에 비해 수익이 잘 난 날 (슈퍼챗 등)</span></span></div><div class="chart" data-chart="rev-eff"></div></div>` : ''}
      <div class="sec-h"><h2>작품별 수익</h2><span class="sub">최근 7일 하루 평균 추정 · 그 속도로 월말까지</span></div>
      <div class="group table-wrap"><table class="tbl plan"><thead><tr><th class="l">작품</th><th>하루 평균</th><th class="l">비중</th><th>이번 달 기록된 만큼${since ? `<span class="sub small"> (${since}~)</span>` : ''}</th><th>월말까지 더</th></tr></thead><tbody>${planRows(true, '원', 'money') + planRows(false, '캐시', 'cash') || '<tr><td class="l sub" colspan="5">아직 계산할 기록이 없어요</td></tr>'}</tbody></table></div>
      <div class="sec-h" style="margin-top:30px"></div>${heroPanel('cash')}
      <div class="sec-h"><h2>달마다</h2><span class="sub">그 달 마지막 기록 기준</span></div>
      <div class="group table-wrap"><table class="tbl"><thead><tr><th class="l">달</th><th>정산 예상 현금</th><th>정산 예상 캐시</th><th title="크랙이 보내 주는 값을 그대로 보여 줘요">월 슈퍼챗</th><th class="l">기준 기록</th></tr></thead><tbody>${months.map(m => `<tr style="cursor:default"><td class="l">${m.month.replace('-', '년 ')}월</td><td class="num">${fmt(m.money)}원</td><td class="num">${fmt(m.cash)}</td><td class="num">${fmt(m.superChat)}</td><td class="l sub">${esc(m.id)}</td></tr>`).join('')}</tbody></table></div>
      <details class="disclosure"><summary>구간 장부 <span class="sub small">기록과 기록 사이에 늘어난 정산 예상 · ${E.length}구간</span></summary>
      <div class="group table-wrap"><table class="tbl"><thead><tr><th class="l">구간</th><th>현금</th><th>캐시</th><th class="l">메모</th></tr></thead><tbody>${E.map(e => `<tr style="cursor:default"><td class="l num">${esc(e.from)} → ${esc(e.to.slice(5))}</td><td class="num">${e.poolM == null ? '–' : sfmt(e.poolM) + '원'}</td><td class="num">${e.poolC == null ? '–' : sfmt(e.poolC)}</td><td class="l sub small">${e.cross ? '달이 바뀐 구간 · 지난달 말 증가분은 빠졌을 수 있어요' : e.poolM == null && e.poolC == null ? '정산 정보 없음' : ''}</td></tr>`).join('') || '<tr><td class="l sub" colspan="4">아직 구간이 없어요</td></tr>'}</tbody></table></div></details>
      <p class="note">작품별 수익은 추정치예요. 두 기록 사이 계정 정산 증가분을 그 사이 작품별 대화 증가 비율로 나눠요. 현금은 오리지널 작품끼리, 캐시는 나머지 작품끼리 나눠요. 추가 기능 사용량이나 온리 가산은 반영되지 않아요. 그래서 같은 종류 작품끼리는 대화 1천 개당 수익이 같게 계산돼요.</p>`;
  }
  function drawRevenue() {
    const M = MODEL, R = M.R;
    const el = document.querySelector('[data-chart="rev-daily"]');
    if (el) { const d = H.daily(M.acct.money, R.view, R.end); const full = d.filter(x => !x.partial); C.bars(el, { layers: [{ label: '정산 예상 현금', color: COL('money'), data: d }], avg: full.length ? full.reduce((s, x) => s + x.v, 0) / full.length : null, fmt: n => sfmt(n) + '원', aria: '하루 정산 예상 현금' }); }
    const ee = document.querySelector('[data-chart="rev-eff"]');
    if (ee) { const e = H.efficiency(M.S, R.view, R.end).money; C.bars(ee, { layers: [{ label: '대화 1천 개당 현금', color: COL('money'), data: e.days }], avg: e.per, height: 150, fmt: n => fmt(n) + '원', aria: '날마다 대화 1천 개당 현금' }); }
  }

  // ---------- 페이지: 기록 ----------
  let PICK = new Set();
  function pageRecords() {
    const S = DATA.snaps.slice().reverse();
    return `<div class="drop" id="drop"><b>백업 파일 불러오기</b>펄스에서 내보낸 json 파일을 여기로 끌어다 놓거나 <button class="link" id="pickFiles">파일 고르기</button><input type="file" id="fileIn" accept=".json,application/json" multiple hidden></div>
      <div class="row-actions">
        <button class="btn" id="expAll" ${S.length ? '' : 'disabled'}>전체 내보내기</button>
        <button class="btn danger" id="delSel" ${PICK.size ? '' : 'disabled'}>선택한 기록 지우기${PICK.size ? ` (${PICK.size})` : ''}</button>
        <button class="btn" id="rebuild" title="스냅샷이 지워진 옛 구간까지 비우고, 지금 있는 기록만으로 장부를 다시 만들어요" ${S.length ? '' : 'disabled'}>장부 다시 계산</button>
        <span class="sub small" style="margin-left:auto">기록 ${S.length}개</span>
      </div>
      <div class="group snap-list">${S.map(s => `<label class="group-row"><input type="checkbox" data-pick="${esc(s.id)}" ${PICK.has(s.id) ? 'checked' : ''}><span class="grow num">${esc(s.id)}</span><span class="sub small">작품 ${s.works.length}개</span><span class="small ${s.account ? 'sub' : 'down'}" style="width:92px;text-align:right">${s.account ? '정산 정보 있음' : '정산 정보 없음'}</span></label>`).join('') || '<div class="group-row sub">아직 기록이 없어요.</div>'}</div>
      <p class="note">기록은 이 브라우저(확장 프로그램 저장소)에 보관돼요. 컴퓨터를 옮기거나 브라우저를 지우기 전에 전체 내보내기로 백업해 두세요. 지운 기록이 있어도 그 구간의 수익은 장부에 남아요.</p>`;
  }
  async function importFiles(files) {
    let snaps = [], ledger = null, bad = 0;
    for (const f of files) {
      try { const r = H.parseImport(JSON.parse(await f.text())); snaps = snaps.concat(r.snaps); if (r.ledger) ledger = r.ledger; if (!r.snaps.length && !r.ledger) bad++; } catch (e) { bad++; }
    }
    if (!snaps.length && !ledger) { toast('읽을 수 있는 기록 파일이 없었어요.'); return; }
    const before = DATA.snaps.length;
    const all = H.mergeSnaps(DATA.snaps, snaps);
    const base = ledger && !(DATA.ledger && DATA.ledger.entries.length) ? ledger : (ledger ? { entries: mergeEntries(DATA.ledger.entries, ledger.entries) } : DATA.ledger);
    await chrome.storage.local.set({ snaps: all, ledger: H.rebuildLedger(all, base) });
    const m = Object.assign({}, DATA.meta); m.lastTaken = Math.max(m.lastTaken || 0, ...all.map(s => s.t)); await chrome.storage.local.set({ meta: m });
    toast(`기록 ${all.length - before}개를 더했어요${ledger ? ' · 수익 장부 포함' : ''}${bad ? ` · 읽지 못한 파일 ${bad}개` : ''}`);
  }
  const mergeEntries = (a, b) => { const m = new Map(); a.concat(b).forEach(e => m.set(e.from + '|' + e.to, e)); return [...m.values()]; };
  function exportAll() {
    const S = DATA.snaps; if (!S.length) return;
    const out = { format: 'heunghengpan-all', exported_at: new Date().toISOString(), snapshots: S.map(H.toFileSnap), ledger: DATA.ledger };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    a.download = '펄스_전체기록_' + S[S.length - 1].id.replace(/[ :]/g, '_') + '.json'; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- 페이지: 설정 ----------
  function pageSettings() {
    const s = DATA.settings;
    return `<div class="sec-h" style="margin-top:12px"><h2>크랙 연결</h2></div>
      <div class="group"><div class="group-row"><span class="dot ${STATUS.loggedIn ? 'ok' : 'no'}"></span><div class="grow">${STATUS.loggedIn ? '크랙에 로그인되어 있어요' : '크랙에 로그인되어 있지 않아요'}<div class="sub small">이 브라우저의 크랙 로그인을 그대로 써요. 따로 로그인 정보를 저장하지 않아요.</div></div><button class="btn" id="openCrack">크랙 열기</button></div></div>
      <div class="sec-h"><h2>자동 스냅샷</h2></div>
      <div class="group"><div class="group-row"><div class="grow">받는 횟수<div class="sub small">브라우저가 켜져 있으면 30분마다 확인해서, 정한 간격이 지났을 때 알아서 받아요.</div></div>${seg('auto', [[0, '끄기'], [1, '하루 1번'], [2, '하루 2번'], [3, '하루 3번']], s.auto)}</div></div>
      <p class="note">비공식 API를 써서, 몇 분마다 받으면 크랙이 요청을 막을 수 있어요. 그래서 하루 3번까지만 고를 수 있고, 막히면 3시간 동안 쉬어요.</p>
      <div class="sec-h"><h2>화면</h2></div>
      <div class="group"><div class="group-row"><div class="grow">모양</div>${seg('theme', [['system', '시스템'], ['light', '라이트'], ['dark', '다크']], s.theme)}</div>
      <div class="group-row"><div class="grow">세이프 버전 합쳐 보기<div class="sub small">"작품명"과 "작품명 ˢᵃᶠᵉᵗʸ"를 한 작품으로 묶어서 봐요.</div></div><input type="checkbox" class="switch" id="grp" ${UI.group ? 'checked' : ''}></div></div>
      <div class="sec-h"><h2>업데이트</h2></div>
      <div class="group"><div class="group-row"><div class="grow">지금 버전 ${esc(chrome.runtime.getManifest().version)}<div class="sub small">${!UPD ? '확인 중…' : !UPD.eligible ? '웹 스토어 설치본은 크롬이 알아서 업데이트해요.' : UPD.available ? `새 버전 ${esc(UPD.latest)}이 나왔어요.` : UPD.error ? `확인하지 못했어요 (${esc(UPD.error)})` : '최신 버전이에요. 깃허브를 몇 시간마다 확인해요.'}</div></div>${UPD && UPD.eligible ? `<button class="btn" id="updCheck">다시 확인</button>` : ''}${UPD && UPD.available ? `<button class="btn primary" id="updOpen">업데이트</button>` : ''}</div></div>
      <p class="note" style="margin-top:22px">펄스 ${esc(chrome.runtime.getManifest().version)} · 넉넉한 취향이 클로드와 함께 만들었어요.</p>`;
  }

  // ---------- 작품 상세 시트 ----------
  function openSheet(key) { SHEET = key; drawSheet(); }
  function closeSheet() { SHEET = null; $('#sheetBack').hidden = true; C.hideTip(); }
  function drawSheet() {
    const f = MODEL && MODEL.fams.find(x => x.key === SHEET); if (!f) { closeSheet(); return; }
    const k = UI.dMetric, M = MODEL, R = M.R, S = M.S;
    const split = f.members.length > 1;
    const href = m => `https://crack.wrtn.ai/${m.type === 'character' ? 'characters/' + m.sourceId + '/detail' : 'detail/' + m.sourceId}`;
    const lm = f.members.filter(m => m.sourceId).sort((a, b) => b.adult - a.adult);
    const links = !lm.length ? '' : split ? '<span class="sub small">크랙에서 보기</span> ' + lm.map(m => `<a class="link small" target="_blank" rel="noopener" href="${href(m)}">${m.adult ? '언세이프' : '세이프'}</a>`).join('<span class="faint small"> · </span>') : `<a class="link small" target="_blank" rel="noopener" href="${href(lm[0])}">크랙에서 보기</a>`;
    const tile = (lbl, v, s) => `<div class="tile"><div class="lbl">${lbl}</div><div class="v num">${v}</div><div class="s num">${s || ''}</div></div>`;
    const V = { public: '공개', private: '비공개', linkonly: '링크 공개' };
    $('#sheet').innerHTML = `<div class="sheet-h"><div><h2>${esc(f.name)}</h2><div class="tags">${tagsOf(f)}<span style="margin-left:8px">${links}</span></div></div><button class="btn" id="shClose">닫기</button></div>
      <div class="group tiles" style="margin-top:16px">${tile('총 대화', fmt(f.last.msg), `대화방 ${fmt(f.last.chat)} · 방당 ${f.rroom ? f.rroom.toFixed(1) : '–'}`)}${tile(`${H.PERIODS[UI.period].label} 대화 증가`, sfmt(f.inc), `하루 평균 ${sfmt(f.perDay)}`)}${tile('좋아요', fmt(f.last.like), `${H.PERIODS[UI.period].label} ${sfmt(f.dLike)}`)}${tile(`추정 수익 (${f.unit})`, f.rev > 0.5 ? '≈ ' + fmt(f.rev) : '–', f.revAll > 0.5 ? `장부 전체 ≈ ${fmt(f.revAll)}` : '')}</div>
      <div class="sec-h"><h2>추이</h2>${seg('dMetric', Object.entries(METRICS), k)}</div>
      <div class="group chart-panel"><div class="chart-top"><span style="display:flex;align-items:center;gap:12px">${seg('dview', [['day', '하루씩'], ['rate', '시간당']], UI.dview)}<span class="t">${UI.dview === 'rate' ? `기록 사이 시간당 ${METRICS[k]}` : `하루 ${METRICS[k]} 증가`}</span></span><span class="legend">${UI.dview === 'rate' ? '<span>두 버전 합계 · 칸 너비 = 기록 사이 시간</span>' : `${split ? `<span><span class="sw" style="background:var(--s-unsafe)"></span>언세이프</span><span><span class="sw" style="background:var(--s-safe)"></span>세이프</span>` : ''}<span><span class="hatch"></span>추정</span>`}</span></div><div class="chart" data-chart="sh-daily"></div></div>
      <div class="sec-h"><h2>누적 ${METRICS[k]}</h2></div>
      <div class="group chart-panel"><div class="chart" data-chart="sh-line"></div></div>
      ${split ? `<div class="sec-h"><h2>버전별</h2></div><div class="group table-wrap"><table class="tbl"><thead><tr><th class="l">버전</th><th class="l">상태</th><th>대화</th><th>좋아요</th><th>댓글</th><th>대화방</th><th>방당 대화</th><th>생성일</th></tr></thead><tbody>${f.members.map(m => `<tr style="cursor:default"><td class="l">${m.adult ? '언세이프' : '세이프'}</td><td class="l">${V[m.visibility] || m.visibility}</td><td class="num">${fmt(m.msg)}</td><td class="num">${fmt(m.like)}</td><td class="num">${fmt(m.comment)}</td><td class="num">${fmt(m.chat)}</td><td class="num">${m.chat ? (m.msg / m.chat).toFixed(1) : '–'}</td><td class="sub">${esc(m.created)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    $('#sheetBack').hidden = false;
    $('#shClose').onclick = closeSheet;
    const mem = split ? f.members.slice().sort((a, b) => b.adult - a.adult) : [f];
    const layers = mem.map(m => ({ label: split ? (m.adult ? '언세이프' : '세이프') : METRICS[k], color: split ? COL(m.adult ? 'unsafe' : 'safe') : COL(k === 'msg' ? 'msg' : k), data: H.daily(H.workPoints(S, split ? [m.id] : f.ids, k), R.view, R.end) }));
    if (UI.dview === 'rate') C.steps(document.querySelector('[data-chart="sh-daily"]'), { pts: H.workPoints(S, f.ids, k), from: R.view, color: COL(k === 'msg' ? 'msg' : k), fmt: sfmt, height: 190 });
    else C.bars(document.querySelector('[data-chart="sh-daily"]'), { layers, fmt: sfmt, height: 190 });
    C.line(document.querySelector('[data-chart="sh-line"]'), { series: [{ label: split ? `${METRICS[k]} (두 버전 합계)` : METRICS[k], color: COL(k === 'msg' ? 'msg' : k), pts: H.workPoints(S, f.ids, k).filter(p => p.t >= R.view - 1) }], fmt, height: 170, aria: `누적 ${METRICS[k]}` });
  }

  // ---------- 대화상자 / 알림 ----------
  function dialog(title, body, ok, single) {
    return new Promise(res => {
      const back = document.createElement('div'); back.className = 'sheet-back';
      back.innerHTML = `<div class="sheet" style="width:min(400px,100%);text-align:center;padding:22px 22px 16px" role="alertdialog"><img src="icons/128.png" width="54" height="54" alt="" style="border-radius:12px"><h2 style="font-size:15px;margin:10px 0 6px">${esc(title)}</h2><p class="sub" style="margin:0 0 18px;font-size:12.5px;line-height:1.55">${esc(body)}</p><div style="display:flex;gap:8px">${single ? '' : '<button class="btn big" style="flex:1" data-r="0">취소</button>'}<button class="btn primary big" style="flex:1" data-r="1">${esc(ok)}</button></div></div>`;
      document.body.appendChild(back);
      back.querySelector('[data-r="1"]').focus();
      const done = v => { back.remove(); document.removeEventListener('keydown', kd, true); res(v); };
      const kd = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      document.addEventListener('keydown', kd, true);
      back.onclick = e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); };
    });
  }
  // 숫자 하나 입력받는 맥 스타일 시트. 취소 → undefined, 비우고 저장 → 0
  function askNumber(title, body, initial, unit) {
    return new Promise(res => {
      const back = document.createElement('div'); back.className = 'sheet-back';
      back.innerHTML = `<div class="sheet" style="width:min(400px,100%);padding:22px 22px 16px" role="dialog"><h2 style="font-size:15px;margin:0 0 6px;text-align:center">${esc(title)}</h2><p class="sub" style="margin:0 0 14px;font-size:12.5px;line-height:1.55;text-align:center">${esc(body)}</p>
        <label class="numin"><input type="text" inputmode="numeric" value="${initial ? Math.round(initial).toLocaleString('ko-KR') : ''}" placeholder="예: 2,000,000" aria-label="${esc(title)}"><span>${esc(unit)}</span></label>
        <div class="qpick">${[1.1, 1.2, 1.3].map(m => `<button class="btn" data-q="${m}">월말 예상의 ${Math.round(m * 100)}%</button>`).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:16px">${initial ? '<button class="btn big danger" style="flex:1" data-r="clear">목표 지우기</button>' : ''}<button class="btn big" style="flex:1" data-r="0">취소</button><button class="btn primary big" style="flex:1" data-r="1">저장</button></div></div>`;
      document.body.appendChild(back);
      const inp = back.querySelector('input'); inp.focus(); inp.select();
      const val = () => +String(inp.value).replace(/[^\d]/g, '') || 0;
      inp.oninput = () => { const v = val(); const pos = inp.value.length - inp.selectionStart; inp.value = v ? v.toLocaleString('ko-KR') : ''; const p2 = Math.max(0, inp.value.length - pos); inp.setSelectionRange(p2, p2); };
      const done = v => { back.remove(); document.removeEventListener('keydown', kd, true); res(v); };
      const kd = e => { if (e.key === 'Escape') { e.stopPropagation(); done(undefined); } if (e.key === 'Enter') { e.preventDefault(); done(val()); } };
      document.addEventListener('keydown', kd, true);
      back.onclick = e => {
        const q = e.target.closest('[data-q]'); if (q) { const fc = MODEL.fcMoney; const base = (title.includes('캐시') ? MODEL.fcCash : fc); if (base) { const v = Math.round(base.value * +q.dataset.q / 10000) * 10000; inp.value = v.toLocaleString('ko-KR'); inp.focus(); } return; }
        const b = e.target.closest('[data-r]'); if (!b) return;
        done(b.dataset.r === '1' ? val() : b.dataset.r === 'clear' ? 0 : undefined);
      };
    });
  }
  async function setGoal(kind) {
    const key = H.monthKey(MODEL.S[MODEL.S.length - 1].t) + ':' + kind, cur = (DATA.settings.goals || {})[key];
    const m = new Date(MODEL.S[MODEL.S.length - 1].t).getMonth() + 1;
    const v = await askNumber(`${m}월 ${kind === 'money' ? '현금' : '캐시'} 목표`, '정산 예상이 이 금액에 닿으려면 하루에 얼마씩 늘어야 하는지 알려 줘요. 달마다 따로 정해요.', cur, kind === 'money' ? '원' : '캐시');
    if (v === undefined) return;
    const goals = Object.assign({}, DATA.settings.goals || {}); if (v > 0) goals[key] = v; else delete goals[key];
    await chrome.storage.local.set({ settings: Object.assign({}, DATA.settings, { goals }) });
  }
  let toastT = null;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 4200); }

  // ---------- 그리기 ----------
  const PAGES = { overview: ['개요', pageOverview], works: ['작품', pageWorks], revenue: ['수익', pageRevenue], records: ['기록', pageRecords], settings: ['설정', pageSettings] };
  function welcome() {
    return `<div class="welcome"><img src="icons/128.png" width="72" height="72" alt=""><h2>아직 기록이 없어요</h2><p>스냅샷을 하루 몇 번씩 쌓으면 작품별 하루 추이와 이번 달 정산 예상이 여기에 나타나요.</p>
      <div class="group steps">
        <div class="group-row"><span class="n">1</span><div class="grow">크랙에 로그인하기<div class="sub small">이미 로그인되어 있으면 건너뛰어도 돼요.</div></div><button class="btn" id="wCrack">크랙 열기</button></div>
        <div class="group-row"><span class="n">2</span><div class="grow">첫 스냅샷 받기<div class="sub small">작품 수에 따라 1~2분 걸려요.</div></div><button class="btn primary" id="wSnap">스냅샷 받기</button></div>
        <div class="group-row"><span class="n">3</span><div class="grow">자동 스냅샷 켜기<div class="sub small">하루 2번이면 따로 신경 쓸 일 없어요.</div></div><a class="btn" href="#settings">설정 열기</a></div>
      </div>
</div>`;
  }
  function tools(page) {
    if (!DATA.snaps.length || page === 'records' || page === 'settings') return '';
    let t = '';
    if (page === 'works') t += `<label class="search"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4 4"/></svg><input type="search" id="q" placeholder="작품 검색" value="${esc(UI.q)}"></label>` + seg('vis', [['public', '공개'], ['all', '전체']], UI.vis);
    return t + periodSeg();
  }
  function render() {
    const page = PAGES[UI.page] ? UI.page : 'overview';
    MODEL = build();
    document.querySelectorAll('.nav').forEach(a => a.classList.toggle('on', a.dataset.page === page));
    $('#pageTitle').textContent = PAGES[page][0];
    const empty = !DATA.snaps.length && page !== 'records' && page !== 'settings';
    $('#pageSub').textContent = empty ? '' : (page === 'records' || page === 'settings') ? '' : periodSub();
    $('#tbTools').innerHTML = tools(page);
    $('#content').innerHTML = empty ? welcome() : PAGES[page][1]();
    if (!empty) { if (page === 'overview' || page === 'revenue') drawHeroCharts(); if (page === 'overview') drawDaily(); if (page === 'revenue') drawRevenue(); }
    bindDrop();
    const q = $('#q'); if (q) q.oninput = () => { UI.q = q.value; const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    if (SHEET) drawSheet();
    drawSide();
  }
  function bindDrop() {
    const d = $('#drop'), fi = $('#fileIn'), pk = $('#pickFiles');
    if (pk) pk.onclick = () => fi.click();
    if (fi) fi.onchange = () => { importFiles([...fi.files]); fi.value = ''; };
    if (!d) return;
    d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); importFiles([...e.dataTransfer.files].filter(f => /\.json$/i.test(f.name))); };
  }

  // ---------- 이벤트 ----------
  document.addEventListener('click', async e => {
    const t = e.target;
    const sb = t.closest('[data-seg] button');
    if (sb) {
      const name = sb.closest('[data-seg]').dataset.seg, v = sb.dataset.v;
      if (name === 'auto' || name === 'theme') { const s = Object.assign({}, DATA.settings, { [name]: name === 'auto' ? +v : v }); await chrome.storage.local.set({ settings: s }); if (name === 'theme') window.hhApplyTheme(v); if (name === 'auto' && +v) toast(`자동 스냅샷: 하루 ${v}번`); return; }
      UI[name] = v; saveUI(); if (name === 'dMetric') drawSheet(); else render(); return;
    }
    const th = t.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; if (UI.sortKey === k) UI.sortDir *= -1; else { UI.sortKey = k; UI.sortDir = k === 'name' || k === 'created' ? 1 : -1; } saveUI(); render(); return; }
    const fam = t.closest('[data-fam]');
    if (fam && !t.closest('a')) { openSheet(fam.dataset.fam); return; }
    if (t.id === 'sheetBack') { closeSheet(); return; }
    if (t.id === 'openCrack' || t.id === 'wCrack') { send({ type: 'openCrack' }); return; }
    const gb = t.closest('[data-goal]'); if (gb) { setGoal(gb.dataset.goal); return; }
    if (t.id === 'wSnap') { snapshot(); return; }
    if (t.id === 'updOpen') { send({ type: 'openUpdate' }); return; }
    if (t.id === 'updCheck') { t.disabled = true; t.textContent = '확인 중…'; UPD = await send({ type: 'updateStatus', force: true }); render(); toast(UPD && UPD.available ? `새 버전 ${UPD.latest}이 있어요` : UPD && UPD.error ? '확인하지 못했어요' : '최신 버전이에요'); return; }
    if (t.id === 'expAll') { exportAll(); return; }
    if (t.id === 'rebuild') { if (await dialog('장부를 다시 계산할까요?', '지금 남아 있는 기록만으로 구간 장부를 새로 만들어요. 지운 기록 구간에서 쌓였던 수익은 사라져요.', '다시 계산')) await chrome.storage.local.set({ ledger: H.rebuildLedger(DATA.snaps, null) }); return; }
    if (t.id === 'delSel') {
      if (!PICK.size) return;
      if (!(await dialog(`기록 ${PICK.size}개를 지울까요?`, '지운 기록은 되돌릴 수 없어요. 그 구간의 수익은 장부에 남아요.', '지우기'))) return;
      const keep = DATA.snaps.filter(s => !PICK.has(s.id)); PICK = new Set();
      await chrome.storage.local.set({ snaps: keep, ledger: H.rebuildLedger(keep, DATA.ledger) }); return;
    }
  });
  document.addEventListener('change', e => {
    const p = e.target.dataset && e.target.dataset.pick;
    if (p) { if (e.target.checked) PICK.add(p); else PICK.delete(p); const b = $('#delSel'); if (b) { b.disabled = !PICK.size; b.textContent = '선택한 기록 지우기' + (PICK.size ? ` (${PICK.size})` : ''); } return; }
    if (e.target.id === 'grp') { UI.group = e.target.checked; saveUI(); render(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && SHEET) closeSheet();
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.fam) openSheet(e.target.dataset.fam);
  });
  window.addEventListener('hashchange', () => { UI.page = location.hash.slice(1) || 'overview'; SHEET = null; $('#sheetBack').hidden = true; render(); $('.main').scrollTop = 0; });
  $('.main').addEventListener('scroll', () => $('.toolbar').classList.toggle('scrolled', $('.main').scrollTop > 4));
  let rz = null; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if (!MODEL || !MODEL.R) return; if (UI.page === 'overview' || UI.page === 'revenue') drawHeroCharts(); if (UI.page === 'overview') drawDaily(); if (UI.page === 'revenue') drawRevenue(); if (SHEET) drawSheet(); }, 120); }).observe($('#content'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());

  if (hasChrome) {
    chrome.storage.onChanged.addListener(async (ch, area) => { if (area !== 'local') return; await load(); if (ch.settings && !ch.snaps && !ch.ledger) { if (UI.page === 'records') drawSide(); else render(); return; } render(); refreshStatus(); });
    if (chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(m => { if (m.type === 'progress') { STATUS.run = m.run; drawSide(); } if (m.type === 'done') refreshStatus(); });
  }

  (async function start() {
    UI.page = location.hash.slice(1) || 'overview';
    await load(); render(); refreshStatus(); setInterval(refreshStatus, 60000);
  })();
})();
