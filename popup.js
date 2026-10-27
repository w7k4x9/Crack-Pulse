(function () {
  'use strict';
  const H = window.HH, $ = s => document.querySelector(s);
  const fmt = n => n == null || !isFinite(n) ? '–' : Math.round(n).toLocaleString('ko-KR');
  const sfmt = n => n == null || !isFinite(n) ? '–' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = t => { if (!t) return '없음'; const m = (Date.now() - t) / 60000; if (m < 1) return '방금'; if (m < 60) return Math.floor(m) + '분 전'; if (m < 1440) return Math.floor(m / 60) + '시간 전'; return Math.floor(m / 1440) + '일 전'; };
  const send = m => chrome.runtime.sendMessage(m);
  let D = { snaps: [], settings: {} }, ST = { run: {}, meta: {} }, MSG = '', UP = null;

  async function load() {
    const o = await chrome.storage.local.get(['snaps', 'settings']);
    D.snaps = (o.snaps || []).sort((a, b) => a.t - b.t); D.settings = o.settings || {};
    window.hhApplyTheme(D.settings.theme);
    try { ST = await send({ type: 'status' }) || ST; } catch (e) {}
    try { UP = await send({ type: 'updateStatus' }); } catch (e) {}
  }
  function draw() {
    const S = D.snaps, last = S[S.length - 1], run = ST.run || {}, m = ST.meta || {}, L = ST.lock;
    let money = '';
    if (last) {
      const fc = H.forecast(S, 'expectedMoney'), acct = last.account;
      const all = last.works.map(w => w.id), pts = H.workPoints(S, all, 'msg');
      const e = last.t, D1 = H.DAY;
      const cur = H.delta(pts, e - D1, e), prv = e - D1 - 60000 > pts[0].t ? H.delta(pts, e - 2 * D1, e - D1) : null;
      const curOk = cur && cur.days > 0.9, prvOk = prv && prv.days > 0.9;
      money = `<div class="group money"><div class="lbl"><span class="sw" style="background:var(--s-money)"></span>${new Date(last.t).getMonth() + 1}월 정산 예상 현금</div>
        <div class="big num">${acct && acct.expectedMoney != null ? fmt(acct.expectedMoney) : '–'}<small>원</small></div>
        ${fc ? `<div class="fc"><span>월말 예상 <b class="num">≈ ${fmt(fc.value)}원</b></span><span class="num">${sfmt(fc.perDay)}원/일</span></div>` : ''}
        ${(() => { const G = H.grants(S, D.settings.grant); if (!fc || !G.thisMonth || G.included) return ''; return `<div class="fc"><span>+ 오리지널 지원금 ${fmt(G.thisMonth)}원</span><span class="num">합쳐서 <b>≈ ${fmt(fc.value + G.thisMonth)}원</b></span></div>`; })()}
        ${(() => { const G = H.grants(S, D.settings.grant), add = fc && G.thisMonth && !G.included ? G.thisMonth : 0; const g = (D.settings.goals || {})[H.monthKey(last.t) + ':money'], p = H.goalPlan(add ? Object.assign({}, fc, { now: fc.now + add, value: fc.value + add }) : fc, g); if (!p) return ''; return `<div class="gl"><div class="gb"><div style="width:${Math.min(100, p.pct * 100).toFixed(1)}%"></div></div><div class="fc"><span>목표 ${Math.floor(p.pct * 100)}%</span><span class="${p.likely ? 'up' : 'down'}">${p.reached ? '✓ 달성' : p.likely ? '✓ 지금 속도면 달성' : `하루 ${sfmt(p.perDay)}원 필요`}</span></div></div>`; })()}</div>
        <div class="group mini"><div><div class="l">최근 24시간 대화</div><div class="v num">${curOk ? sfmt(cur.v) : '–'}${curOk && prvOk && prv.v > 0 ? ` <span class="small ${cur.v >= prv.v ? 'up' : 'down'}">${cur.v >= prv.v ? '▲' : '▼'} ${Math.abs(Math.round((cur.v / prv.v - 1) * 100))}%</span>` : ''}</div></div><div><div class="l">그 전 24시간</div><div class="v num">${prvOk ? sfmt(prv.v) : '–'}</div></div></div>`;
    } else money = `<div class="group money"><div class="lbl">아직 기록이 없어요</div><div class="sub small" style="margin-top:4px">크랙에 로그인한 상태에서 스냅샷을 받아 보세요.</div></div>`;
    const btn = run.busy ? '받는 중…' : L && L.hard ? `쉬는 중 (${Math.ceil(L.ms / 60000)}분)` : '스냅샷 받기';
    $('#pop').innerHTML = `<div class="hd"><img src="icons/32.png" width="20" height="20" alt=""><b>펄스</b><button class="st" id="login" title="크랙 열기"><span class="dot ${ST.loggedIn ? 'ok' : 'no'}"></span>${ST.loggedIn ? '크랙 로그인됨' : '로그인 필요'}</button></div>
      ${money}
      ${UP && UP.available ? `<button class="btn" id="upd" style="width:100%;color:var(--accent)">새 버전 ${esc(UP.latest)} 업데이트</button>` : ''}
      <div class="meta"><span>마지막 기록 ${ago(m.lastTaken || (last && last.t))}</span><span>자동 ${D.settings.auto ? '하루 ' + D.settings.auto + '번' : '꺼짐'}</span></div>
      ${run.busy ? `<div class="prog">${esc(run.text || '')}</div>` : ''}
      ${MSG ? `<div class="prog">${esc(MSG)}</div>` : m.lastError ? `<div class="err">${esc(m.lastError.text)}</div>` : ''}
      <div class="acts"><button class="btn big" id="dash">대시보드</button><button class="btn big primary" id="snap" ${run.busy || (L && L.hard) ? 'disabled' : ''}>${btn}</button></div>`;
    $('#login').onclick = () => send({ type: 'openCrack' });
    $('#dash').onclick = () => { send({ type: 'openDashboard' }); window.close(); };
    $('#snap').onclick = snap;
    const u = $('#upd'); if (u) u.onclick = () => { send({ type: 'openUpdate' }); window.close(); };
  }
  async function snap() {
    MSG = '';
    let r = await send({ type: 'snapshot' });
    if (r && r.needConfirm) { MSG = `마지막 기록에서 30분이 안 지났어요 (${r.waitMin}분 남음). 그래도 받으려면 한 번 더 누르세요.`; await load(); draw(); $('#snap').onclick = async () => { MSG = ''; r = await send({ type: 'snapshot', force: true }); done(r); }; return; }
    done(r);
  }
  async function done(r) {
    if (r && r.ok) MSG = `저장됨 · 작품 ${r.count}개${r.account ? '' : ' · 정산 정보는 못 받음'}`;
    else if (r && r.login) { MSG = '크랙 로그인이 필요해요. 위의 "로그인 필요"를 눌러 크랙을 여세요.'; }
    else if (r && r.error) MSG = r.error;
    await load(); draw();
  }
  chrome.runtime.onMessage.addListener(m => { if (m.type === 'progress') { ST.run = m.run; draw(); } });
  load().then(draw);
})();
