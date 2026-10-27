// 펄스 차트 — 직접 그리는 SVG (외부 라이브러리 없음)
(function (G) {
  'use strict';
  const H = G.HH;
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const DAYMS = 86400000;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let uid = 0;

  function nice(max, n = 4) {
    if (!(max > 0)) return { max: 1, step: 1 };
    const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || 10 * p;
    return { max: Math.ceil(max / step - 1e-9) * step, step };
  }
  const kfmt = v => { const a = Math.abs(v); if (a >= 1e8) return +(v / 1e8).toFixed(1) + '억'; if (a >= 1e4) return +(v / 1e4).toFixed(a >= 1e5 ? 0 : 1) + '만'; if (a >= 1e3) return +(v / 1e3).toFixed(1) + '천'; return String(Math.round(v)); };
  const dlabel = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const dlong = t => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };
  const tlong = t => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${H.pad(d.getHours())}:${H.pad(d.getMinutes())}`; };

  // ---------- 툴팁 ----------
  const tipEl = () => document.getElementById('tip');
  function showTip(html, ev) {
    const t = tipEl(); if (!t) return;
    t.innerHTML = html; t.style.display = 'block';
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
    t.style.left = Math.max(6, x) + 'px'; t.style.top = Math.max(6, y) + 'px';
  }
  function hideTip() { const t = tipEl(); if (t) t.style.display = 'none'; }

  const widthOf = el => Math.max(280, Math.round(el.clientWidth || el.getBoundingClientRect().width || 600));
  const hatchDef = (id, col) => `<pattern id="${id}" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><rect width="5" height="5" fill="${col}" fill-opacity=".22"/><line x1="0" y1="0" x2="0" y2="5" stroke="${col}" stroke-width="2.2"/></pattern>`;
  // 위쪽만 둥근 막대
  function barPath(x, y, w, h, r) {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // ---------- 하루 단위 막대 (쌓기 가능) ----------
  // opt: {layers:[{label,color,data:[{t,v,est,partial}]}], fmt, unit, height}
  function bars(el, opt) {
    const layers = opt.layers.filter(l => l.data && l.data.length);
    if (!layers.length) { el.innerHTML = `<div class="empty-chart">${opt.empty || '기록이 두 개 이상 쌓이면 하루 단위 추이가 나타나요.'}</div>`; return; }
    const days = layers[0].data.map(d => d.t);
    const W = widthOf(el), Hh = opt.height || 200, L = 46, R = 6, T = 12, B = 24;
    const tot = days.map((t, i) => layers.reduce((s, l) => s + Math.max(0, (l.data[i] || {}).v || 0), 0));
    const n = nice(Math.max(...tot, 0));
    const ih = Hh - T - B, iw = W - L - R, band = iw / days.length, bw = Math.max(3, Math.min(34, band * 0.62));
    const Y = v => T + ih - ih * v / n.max;
    const id = 'h' + (++uid);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(opt.aria || '하루 단위 추이')}"><defs>${layers.map((l, k) => hatchDef(id + k, l.color)).join('')}</defs>`;
    for (let v = 0; v <= n.max + 1e-9; v += n.step) s += `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 8}" y="${Y(v) + 3.5}" text-anchor="end">${kfmt(v)}</text>`;
    const every = Math.ceil(days.length / Math.max(2, Math.floor(iw / 46)));
    days.forEach((t, i) => {
      const cx = L + band * i + band / 2, x = cx - bw / 2;
      let base = 0;
      layers.forEach((l, k) => {
        const d = l.data[i] || {}, v = Math.max(0, d.v || 0); if (!v) return;
        const y0 = Y(base), y1 = Y(base + v), top = k === layers.length - 1 || layers.slice(k + 1).every(q => !((q.data[i] || {}).v > 0));
        const gap = base > 0 ? 2 : 0, h = y0 - y1 - gap;
        const fill = d.est ? `url(#${id + k})` : l.color;
        s += top ? `<path d="${barPath(x, y1, bw, h, 4)}" fill="${fill}" opacity="${d.partial ? .5 : 1}"/>` : `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, h)}" fill="${fill}" opacity="${d.partial ? .5 : 1}"/>`;
        base += v;
      });
      if (i % every === 0 || i === days.length - 1) { const d = new Date(t); const lab = ((i === 0 || d.getDate() === 1) ? dlabel(t) : String(d.getDate())) + (band * every >= 44 ? ` <tspan class="ax">${WD[d.getDay()]}</tspan>` : ''); s += `<text class="axx" x="${cx}" y="${Hh - 6}" text-anchor="middle">${lab}</text>`; }
      s += `<rect data-i="${i}" x="${L + band * i}" y="${T}" width="${band}" height="${ih}" fill="transparent"/>`;
    });
    if (opt.avg > 0 && opt.avg <= n.max) s += `<line x1="${L}" x2="${W - R}" y1="${Y(opt.avg)}" y2="${Y(opt.avg)}" stroke="var(--label-2)" stroke-width="1.2" stroke-dasharray="4 4" pointer-events="none"/><text x="${W - R - 2}" y="${Y(opt.avg) - 5}" text-anchor="end" font-size="10.5" fill="var(--label-2)" pointer-events="none">평균 ${kfmt(opt.avg)}</text>`;
    s += `<line class="bl" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/></svg>`;
    el.innerHTML = s;
    el.querySelectorAll('rect[data-i]').forEach(r => {
      const i = +r.dataset.i;
      const show = ev => {
        const d0 = layers[0].data[i];
        let h = `<b>${dlong(days[i])}</b>`;
        layers.forEach(l => { const d = l.data[i]; if (d) h += `<br><span class="sw" style="background:${l.color}"></span>${esc(l.label)} <b>${opt.fmt(d.v)}</b>`; });
        if (layers.length > 1) h += `<br><span class="faint">합계</span> <b>${opt.fmt(tot[i])}</b>`;
        if (d0.partial) h += `<br><span class="faint">${Math.round(d0.cover * 24)}시간치만 기록됨</span>`;
        if (d0.est) h += `<br><span class="faint">이날 기록이 없어 앞뒤 기록 사이를 고르게 나눈 값</span>`;
        showTip(h, ev);
      };
      r.addEventListener('mousemove', show); r.addEventListener('mouseleave', hideTip);
    });
  }

  // ---------- 이번 달 정산 곡선 + 월말 예상 ----------
  // opt: {pts:[{t,v(raw),id}], fc, color, fmt}
  function month(el, opt) {
    const pts = opt.pts; if (!pts.length) { el.innerHTML = '<div class="empty-chart">정산 정보가 담긴 기록이 아직 없어요.</div>'; return; }
    const ms = H.monthStart(pts[pts.length - 1].t), me = H.monthEnd(pts[pts.length - 1].t);
    const W = widthOf(el), Hh = opt.height || 210, L = 48, R = 64, T = 14, B = 24;
    const fc = opt.fc, top = Math.max(...pts.map(p => p.v), fc ? fc.value : 0, fc && fc.range ? fc.range.hi : 0, opt.goal || 0);
    const n = nice(top), iw = W - L - R, ih = Hh - T - B;
    const X = t => L + iw * (t - ms) / (me - ms), Y = v => T + ih - ih * v / n.max;
    const col = opt.color, id = 'm' + (++uid);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="이번 달 정산 예상 추이"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>`;
    for (let v = 0; v <= n.max + 1e-9; v += n.step) s += `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 8}" y="${Y(v) + 3.5}" text-anchor="end">${kfmt(v)}</text>`;
    const lastDay = new Date(me - 1).getDate();
    [1, 8, 15, 22, lastDay].forEach(d => { const t = new Date(new Date(ms).getFullYear(), new Date(ms).getMonth(), d).getTime(); s += `<text class="axx" x="${X(t)}" y="${Hh - 6}" text-anchor="middle">${d === 1 ? dlabel(t) : d}</text>`; });
    // 첫 기록 전: 1일 0원에서 첫 기록까지 (점선, 흐리게)
    const p0 = pts[0];
    if (p0.t - ms > 3600000) s += `<line x1="${X(ms)}" y1="${Y(0)}" x2="${X(p0.t)}" y2="${Y(p0.v)}" stroke="${col}" stroke-width="1.5" stroke-dasharray="1 4" stroke-linecap="round" opacity=".55"/>`;
    const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1)).join('');
    // 1일(0)부터 이어지는 쐐기 모양으로 옅게 채움
    s += `<path d="M${X(ms)},${Y(0)}L${line.slice(1)}L${X(pts[pts.length - 1].t).toFixed(1)},${Y(0)}Z" fill="url(#${id})" opacity=".7"/>`;
    s += `<path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const Lp = pts[pts.length - 1];
    if (opt.goal) s += `<line x1="${L}" x2="${X(me)}" y1="${Y(opt.goal)}" y2="${Y(opt.goal)}" stroke="var(--label-2)" stroke-width="1.2" stroke-dasharray="2 3"/><text x="${L + 6}" y="${Y(opt.goal) - 5}" font-size="10.5" fill="var(--label-2)">목표 ${kfmt(opt.goal)}</text>`;
    if (fc && fc.range) s += `<path d="M${X(Lp.t)},${Y(Lp.v)}L${X(me)},${Y(fc.range.hi)}L${X(me)},${Y(fc.range.lo)}Z" fill="${col}" opacity=".14"/>`;
    if (fc) {
      s += `<line x1="${X(Lp.t)}" y1="${Y(Lp.v)}" x2="${X(me)}" y2="${Y(fc.value)}" stroke="${col}" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" opacity=".8"/>`;
      s += `<circle cx="${X(me)}" cy="${Y(fc.value)}" r="4" fill="var(--panel)" stroke="${col}" stroke-width="2"/>`;
      s += `<text x="${X(me) + 8}" y="${Y(fc.value) - 2}" font-size="11.5" font-weight="650" fill="var(--label)">${kfmt(fc.value)}</text><text x="${X(me) + 8}" y="${Y(fc.value) + 12}" font-size="10.5" fill="var(--label-2)">월말 예상</text>`;
    }
    s += `<line class="bl" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/>`;
    s += `<line id="${id}v" y1="${T}" y2="${T + ih}" stroke="var(--label-3)" stroke-dasharray="3 3" style="display:none"/>`;
    pts.forEach(p => { s += `<circle cx="${X(p.t)}" cy="${Y(p.v)}" r="3" fill="${col}" stroke="var(--panel)" stroke-width="2"/>`; });
    s += `<circle id="${id}d" r="5" fill="${col}" stroke="var(--panel)" stroke-width="2" style="display:none"/>`;
    s += `<rect class="hit" x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
    el.innerHTML = s;
    const svg = el.querySelector('svg'), hit = el.querySelector('.hit'), vl = el.querySelector('#' + id + 'v'), dot = el.querySelector('#' + id + 'd');
    hit.addEventListener('mousemove', ev => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * W / r.width;
      let best = 0; pts.forEach((p, i) => { if (Math.abs(X(p.t) - x) < Math.abs(X(pts[best].t) - x)) best = i; });
      const p = pts[best], pv = pts[best - 1];
      vl.setAttribute('x1', X(p.t)); vl.setAttribute('x2', X(p.t)); vl.style.display = '';
      dot.setAttribute('cx', X(p.t)); dot.setAttribute('cy', Y(p.v)); dot.style.display = '';
      let h = `<b>${tlong(p.t)}</b><br><span class="sw" style="background:${col}"></span>${esc(opt.label)} <b>${opt.fmt(p.v)}</b>`;
      if (pv) { const hrs = (p.t - pv.t) / 3600000; h += `<br><span class="faint">직전 기록보다</span> <b>+${opt.fmt(p.v - pv.v)}</b> <span class="faint">(${hrs < 48 ? Math.round(hrs) + '시간' : Math.round(hrs / 24) + '일'} 사이)</span>`; }
      showTip(h, ev);
    });
    hit.addEventListener('mouseleave', () => { hideTip(); vl.style.display = 'none'; dot.style.display = 'none'; });
  }

  // ---------- 누적 선 (작품 상세) ----------
  function line(el, opt) {
    const ser = opt.series.filter(s => s.pts.length);
    if (!ser.length || ser.every(s => s.pts.length < 2)) { el.innerHTML = '<div class="empty-chart">기록이 두 개 이상 필요해요.</div>'; return; }
    const all = ser.flatMap(s => s.pts), t0 = Math.min(...all.map(p => p.t)), t1 = Math.max(...all.map(p => p.t));
    const lo0 = Math.min(...all.map(p => p.v)), hi0 = Math.max(...all.map(p => p.v));
    const pad = (hi0 - lo0) * 0.12 || Math.max(1, hi0 * 0.05);
    const W = widthOf(el), Hh = opt.height || 180, L = 52, R = 10, T = 12, B = 24;
    const lo = Math.max(0, lo0 - pad), hi = hi0 + pad, step = nice(hi - lo, 4).step, ylo = Math.floor(lo / step) * step;
    const iw = W - L - R, ih = Hh - T - B, X = t => L + iw * (t1 === t0 ? .5 : (t - t0) / (t1 - t0)), Y = v => T + ih - ih * (v - ylo) / (hi - ylo);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(opt.aria || '누적 추이')}">`;
    for (let v = ylo; v <= hi + 1e-9; v += step) if (Y(v) >= T - 1) s += `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 8}" y="${Y(v) + 3.5}" text-anchor="end">${kfmt(v)}</text>`;
    s += `<text class="axx" x="${L}" y="${Hh - 6}">${dlabel(t0)}</text><text class="axx" x="${W - R}" y="${Hh - 6}" text-anchor="end">${dlabel(t1)}</text>`;
    ser.forEach(se => {
      s += `<path d="${se.pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1)).join('')}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round"/>`;
      se.pts.forEach(p => { s += `<circle cx="${X(p.t)}" cy="${Y(p.v)}" r="3" fill="${se.color}" stroke="var(--panel)" stroke-width="1.5"/>`; });
    });
    s += `<line class="vl" y1="${T}" y2="${T + ih}" stroke="var(--label-3)" stroke-dasharray="3 3" style="display:none"/><rect class="hit" x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
    el.innerHTML = s;
    const svg = el.querySelector('svg'), hit = el.querySelector('.hit'), vl = el.querySelector('.vl');
    const TS = [...new Set(all.map(p => p.t))].sort((a, b) => a - b);
    hit.addEventListener('mousemove', ev => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * W / r.width;
      let t = TS[0]; TS.forEach(u => { if (Math.abs(X(u) - x) < Math.abs(X(t) - x)) t = u; });
      vl.setAttribute('x1', X(t)); vl.setAttribute('x2', X(t)); vl.style.display = '';
      let h = `<b>${tlong(t)}</b>`;
      ser.forEach(se => { const i = se.pts.findIndex(p => p.t === t); if (i < 0) return; const p = se.pts[i], pv = se.pts[i - 1]; h += `<br><span class="sw" style="background:${se.color}"></span>${esc(se.label)} <b>${opt.fmt(p.v)}</b>${pv ? ` <span class="faint">+${opt.fmt(p.v - pv.v)}</span>` : ''}`; });
      showTip(h, ev);
    });
    hit.addEventListener('mouseleave', () => { hideTip(); vl.style.display = 'none'; });
  }

  // ---------- 기록 사이 시간당 속도 (계단) ----------
  // 두 기록 사이에 늘어난 양을 그 사이 시간으로 나눈 값. 칸 너비 = 실제 시간 길이
  function steps(el, opt) {
    const pts = opt.pts.filter(p => p.t >= opt.from - 1);
    const segs = [];
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], h = (b.t - a.t) / 3600000; if (h > 0.05) segs.push({ a: a.t, b: b.t, h, v: b.v - a.v, r: (b.v - a.v) / h }); }
    if (!segs.length) { el.innerHTML = '<div class="empty-chart">기록이 두 개 이상 쌓이면 기록 사이의 시간당 속도가 나타나요.</div>'; return; }
    const W = widthOf(el), Hh = opt.height || 200, L = 46, R = 6, T = 12, B = 24;
    const t0 = segs[0].a, t1 = segs[segs.length - 1].b, n = nice(Math.max(...segs.map(s => s.r), 0));
    const iw = W - L - R, ih = Hh - T - B, X = t => L + iw * (t - t0) / (t1 - t0), Y = v => T + ih - ih * Math.max(0, v) / n.max;
    let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(opt.aria || '기록 사이 시간당 속도')}">`;
    for (let v = 0; v <= n.max + 1e-9; v += n.step) s += `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 8}" y="${Y(v) + 3.5}" text-anchor="end">${kfmt(v)}</text>`;
    // 날짜 눈금 (자정)
    for (let d = H.dayStart(t0) + DAYMS; d <= t1; d = H.addDays(d, 1)) { const x = X(d); s += `<line class="gl" x1="${x}" x2="${x}" y1="${T}" y2="${T + ih}" stroke-dasharray="2 3"/>`; if (iw / ((t1 - t0) / DAYMS) > 26) { const dd = new Date(d); s += `<text class="axx" x="${x}" y="${Hh - 6}" text-anchor="middle">${dd.getDate() === 1 || d - t0 < DAYMS ? dlabel(d) : dd.getDate()}</text>`; } }
    segs.forEach((g, i) => {
      const x0 = X(g.a) + (i ? 1 : 0), x1 = X(g.b) - (i < segs.length - 1 ? 1 : 0), w = Math.max(1.5, x1 - x0), y = Y(g.r);
      s += `<path d="${barPath(x0, y, w, Y(0) - y, Math.min(4, w / 2))}" fill="${opt.color}" opacity="${g.h > 30 ? .55 : .9}"/>`;
      s += `<rect data-g="${i}" x="${x0}" y="${T}" width="${w}" height="${ih}" fill="transparent"/>`;
    });
    s += `<line class="bl" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/></svg>`;
    el.innerHTML = s;
    el.querySelectorAll('rect[data-g]').forEach(r => {
      const g = segs[+r.dataset.g];
      r.addEventListener('mousemove', ev => showTip(`<b>${tlong(g.a)} → ${tlong(g.b).replace(/^\d+월 /, '')}</b><br><span class="sw" style="background:${opt.color}"></span>시간당 <b>${opt.fmt(g.r)}</b><br><span class="faint">${g.h < 48 ? Math.round(g.h * 10) / 10 + '시간' : Math.round(g.h / 24 * 10) / 10 + '일'} 동안 ${opt.fmt(g.v)}</span>${g.h > 30 ? '<br><span class="faint">기록 간격이 길어서 그 사이 오르내림은 알 수 없어요</span>' : ''}`, ev));
      r.addEventListener('mouseleave', hideTip);
    });
  }

  // ---------- 작은 막대 (목록 안 흐름) ----------
  function spark(data, color, w = 84, h = 22) {
    if (!data || data.length < 2) return '<span class="faint small">—</span>';
    const max = Math.max(...data.map(d => d.v), 0) || 1, band = w / data.length, bw = Math.max(2, band * 0.7);
    let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`;
    data.forEach((d, i) => { const bh = Math.max(d.v > 0 ? 1.5 : 0, (h - 2) * Math.max(0, d.v) / max); s += `<rect x="${(i * band + (band - bw) / 2).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1" fill="${color}" opacity="${d.partial ? .4 : d.est ? .55 : 1}"/>`; });
    return s + `<line x1="0" x2="${w}" y1="${h - .25}" y2="${h - .25}" stroke="var(--sep-strong)" stroke-width=".5"/></svg>`;
  }

  G.HC = { bars, steps, month, line, spark, kfmt, dlabel, dlong, tlong, showTip, hideTip, esc };
})(typeof self !== 'undefined' ? self : this);
