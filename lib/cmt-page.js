// 펄스 대시보드 — 댓글 화면. 답글 기다리는 댓글을 모아 보고, 그 자리에서 답글·좋아요.
(function () {
  'use strict';
  const K = window.PulseCmtCore;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = ms => { if (!ms) return ''; const m = (Date.now() - ms) / 60000; if (m < 1) return '방금'; if (m < 60) return Math.floor(m) + '분 전'; if (m < 1440) return Math.floor(m / 60) + '시간 전'; if (m < 1440 * 7) return Math.floor(m / 1440) + '일 전'; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const full = ms => { const d = new Date(ms); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const S = { seenView: null, kept: new Map(), unfold: new Set(), open: null, drafts: {}, busy: {}, prog: '', checking: false, err: {} };

  function list(C, UI) {
    const all = Object.values((C && C.threads) || {}).filter(T => T.status !== 'deleted' && !T.blind);
    const q = (UI.cq || '').trim().toLowerCase();
    const hit = T => !q || [T.work, T.nick, T.text].concat((T.replies || []).map(r => r.nick + ' ' + r.text)).some(x => String(x || '').toLowerCase().includes(q));
    const work = T => !UI.cwork || T.work.replace(/\s*ˢᵃᶠᵉᵗʸ\s*$/, '') === UI.cwork;
    let L;
    if ((UI.cview || 'need') === 'need') L = all.filter(T => (K.needs(T) || S.kept.has(T.id)) && hit(T) && work(T)).sort((a, b) => (b.lastOther || 0) - (a.lastOther || 0));
    else L = all.filter(T => hit(T) && work(T)).sort((a, b) => Math.max(K.ts(b.at), b.lastOther || 0, b.repliedAt || 0) - Math.max(K.ts(a.at), a.lastOther || 0, a.repliedAt || 0));
    return L;
  }
  const avatar = (img, nick) => img ? `<img class="cm-av" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="cm-av ph">${esc(String(nick || '?').slice(0, 1))}</span>`;

  function card(T, seen) {
    const need = K.needs(T), fresh = need && T.lastOther > seen, p = K.pending(T);
    const reps = T.replies || [];
    // 답글은 최근 것 위주로: 답할 게 있으면 그 앞 맥락 1개 + 남이 단 것들, 아니면 마지막 2개
    let show = reps.slice(-2), hidden = reps.length - show.length;
    if (p.replies.length) { let i0 = Math.max(0, reps.indexOf(p.replies[0]) - 1); i0 = Math.max(i0, reps.length - 4); show = reps.slice(i0); hidden = i0; }
    if (S.open === 'all:' + T.id) { show = reps; hidden = 0; }
    const lv = K.level(T), q = need && (p.replies.length ? p.replies.some(r => K.isQuestion(r.text)) : K.isQuestion(T.text));
    const work = T.work.replace(/\s*ˢᵃᶠᵉᵗʸ\s*$/, '');
    const safe = /ˢᵃᶠᵉᵗʸ\s*$/.test(T.work);
    const replying = S.open === T.id, busy = S.busy[T.id];
    const justDone = S.kept.has(T.id) && !need;
    return `<article class="group cm${lv === 'react' ? ' react' : ''}${fresh ? ' fresh' : ''}${justDone ? ' handled' : ''}" data-cm="${esc(T.id)}">
      <div class="cm-row">${avatar(T.img, T.nick)}
        <div class="cm-main">
          <div class="cm-h"><b>${esc(T.nick)}</b>${T.mine ? '<span class="tag or">나</span>' : ''}<span class="cm-work" title="${esc(T.work)}">${esc(work)}${safe ? ' <span class="tag ad">세이프</span>' : ''}</span>${q ? '<span class="tag lk">질문</span>' : ''}${fresh ? '<span class="cm-dot" title="새로 달렸어요"></span>' : ''}<span class="cm-t faint" title="${full(K.ts(T.at))}">${ago(K.ts(T.at))}</span></div>
          <div class="cm-text clamp${p.top && need ? ' hl' : ''}${S.unfold.has(T.id) ? ' open' : ''}" data-fk="${esc(T.id)}">${esc(T.text)}</div>
          ${reps.length ? `<div class="cm-reps">${hidden > 0 ? `<button class="link small" data-cmore="${esc(T.id)}">이전 답글 ${hidden}개 더 보기</button>` : ''}${show.map(r => `<div class="cm-rep${r.mine ? ' me' : ''}${!r.mine && p.replies.includes(r) && need ? ' hl' : ''}"><b>${esc(r.nick)}</b>${r.mine ? '<span class="tag or">나</span>' : ''}<span class="faint small" title="${full(K.ts(r.at))}">${ago(K.ts(r.at))}</span><div class="clamp${S.unfold.has(r.id) ? ' open' : ''}" data-fk="${esc(r.id)}">${esc(r.text)}</div></div>`).join('')}</div>` : ''}
          <div class="cm-act">
            ${justDone ? '<span class="up small">✓ 처리했어요</span>' : `<button class="btn${lv === 'reply' ? ' primary' : ''}" data-creply="${esc(T.id)}">${replying ? '닫기' : '답글'}</button>`}
            <button class="btn cm-like${T.liked ? ' on' : ''}" data-clike="${esc(T.id)}" title="${T.liked ? '좋아요 취소' : '좋아요'}" ${busy === 'like' ? 'disabled' : ''}>${T.liked ? '♥' : '♡'} ${T.likes || 0}</button>
            <a class="btn" href="${esc(K.crackUrl(T))}" target="_blank" rel="noopener">크랙에서 보기</a>
            ${need && !replying ? (lv === 'react' ? `<button class="btn cm-skip2" data-cdone="${esc(T.id)}" title="목록에서 빼요. 새 답글이 달리면 다시 나와요.">✓ 확인했어요</button>` : `<button class="link small cm-skip" data-cdone="${esc(T.id)}" title="답글 없이 목록에서 빼요. 새 답글이 달리면 다시 나와요.">답글 없이 넘기기</button>`) : ''}
          </div>
          ${replying ? `<div class="cm-box"><textarea data-cdraft="${esc(T.id)}" maxlength="1000" rows="3" placeholder="${esc((p.replies.length ? p.replies[p.replies.length - 1].nick : T.nick))}님께 답글">${esc(S.drafts[T.id] || '')}</textarea>
            <div class="cm-box-b"><span class="faint small"><span data-ccount="${esc(T.id)}">${(S.drafts[T.id] || '').length}</span>/1000 · Ctrl+Enter로 등록 · 크랙에 바로 올라가요</span>${S.err[T.id] ? `<span class="down small">${esc(S.err[T.id])}</span>` : ''}<button class="btn primary" data-csend="${esc(T.id)}" ${busy === 'send' ? 'disabled' : ''}>${busy === 'send' ? '올리는 중…' : '등록'}</button></div></div>` : ''}
        </div></div></article>`;
  }

  function page(ctx) {
    const { C, UI } = ctx;
    if (S.seenView == null) S.seenView = (C && C.seenAt) || 0;
    const st = K.stats(C);
    if (!C || !C.checkedAt) return `<div class="welcome"><img src="icons/128.png" width="64" height="64" alt=""><h2>아직 댓글을 확인하지 않았어요</h2><p>내 작품의 새 댓글과 답글을 모아서, 아직 답하지 않은 것부터 보여 줘요. 여기서 바로 답글을 달 수 있어요.</p><button class="btn primary big" id="cCheck">${S.checking ? esc(S.prog || '확인 중…') : '지금 확인하기'}</button><p class="note">처음엔 최근 30일 댓글을 읽어서 1~2분 걸릴 수 있어요.</p></div>`;
    const L = list(C, UI), seen = S.seenView, needView = (UI.cview || 'need') === 'need';
    const kept = T => S.kept.has(T.id) && !K.needs(T);
    const A = needView ? L.filter(T => K.level(T) === 'reply' || (kept(T) && S.kept.get(T.id) === 'reply')) : L;
    const B = needView ? L.filter(T => K.level(T) === 'react' || (kept(T) && S.kept.get(T.id) === 'react')) : [];
    const works = [...new Set(Object.values(C.threads).map(T => T.work.replace(/\s*ˢᵃᶠᵉᵗʸ\s*$/, '')))].sort();
    const head = `<div class="cm-top">
      <div class="cm-sum">${st.need ? `<b class="num">${st.need}</b>개가 답글을 기다려요` : '<span class="up">✓</span> 답글 기다리는 댓글이 없어요'}${st.react ? ` · 내 답글 뒤 반응 ${st.react}개` : ''}${st.fresh ? ` · <span class="accent">새로 온 것 ${st.fresh}개</span>` : ''}</div>
      <select id="cWork" class="cm-sel"><option value="">모든 작품</option>${works.map(w => `<option ${UI.cwork === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select>
    </div>${C.lastError ? `<p class="err small">마지막 확인 실패: ${esc(C.lastError.text)}</p>` : ''}`;
    const empty = (UI.cview || 'need') === 'need'
      ? `<div class="group empty-chart">${UI.cq || UI.cwork ? '조건에 맞는 댓글이 없어요.' : '다 답했어요. 새 댓글이 달리면 여기에 모여요.'}<br><button class="link small" data-seg-go="all">최근 댓글 전체 보기</button></div>`
      : `<div class="group empty-chart">최근 ${45}일 동안 댓글이 없어요.</div>`;
    const N = UI.cmore ? 400 : 60;
    const more = A.length > N && !UI.cmore ? `<div style="text-align:center;margin:12px"><button class="btn" data-more="cmore">${A.length - N}개 더 보기</button></div>` : '';
    return head + `${needView && B.length ? `<div class="sec-h" style="margin-top:4px"><h2>답글이 필요해요</h2><span class="sub">한 번도 답하지 않았거나, 내 답글 뒤에 질문이 온 댓글</span></div>` : ''}<div class="cm-list">${A.length ? A.slice(0, N).map(T => card(T, seen)).join('') : needView && B.length ? '<div class="group empty-chart">답글이 꼭 필요한 댓글은 없어요.</div>' : empty}</div>${more}
      ${B.length ? `<div class="sec-h"><h2>내 답글 뒤에 온 반응</h2><span class="sub">고마워요 같은 말이에요. 읽고 확인만 눌러도 돼요</span></div><div class="cm-list">${B.slice(0, N).map(T => card(T, seen)).join('')}</div>` : ''}
      <p class="note">최근 30일 댓글부터 모아요. 답글은 크랙 사이트와 같은 방식으로, 이 브라우저에 로그인된 계정으로 올라가요. 비공개 작품은 확인하지 않아요.</p>`;
  }
  function tools(ctx) {
    const { C, UI, seg } = ctx, st = K.stats(C);
    if (!C || !C.checkedAt) return '';
    return `<label class="search"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4 4"/></svg><input type="search" id="cq" placeholder="닉네임·내용 검색" value="${esc(UI.cq || '')}"></label>`
      + seg('cview', [['need', `답글 기다림${st.need ? ' ' + st.need : ''}`], ['all', '최근 전체']], UI.cview || 'need')
      + `<button class="tbtn" id="cCheck" title="크랙에서 새 댓글 확인"${S.checking ? ' disabled' : ''}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h12v8H9l-3.5 3v-3H4z"/></svg><span>${S.checking ? esc(S.prog || '확인 중') : '새 댓글 확인'}</span></button>`;
  }
  function sub(ctx) {
    const { C, settings } = ctx; if (!C || !C.checkedAt) return '';
    const every = settings.cmtEvery == null ? 60 : +settings.cmtEvery;
    return `마지막 확인 ${ago(C.checkedAt)} · ${every ? (every >= 60 ? every / 60 + '시간' : every + '분') + '마다 확인' : '자동 확인 꺼짐'}`;
  }
  // 4줄 넘는 글은 접고 "더 보기"를 붙임 (그린 뒤에 실제 높이로 판단)
  function fold(root) {
    (root || document).querySelectorAll('.clamp:not(.open)').forEach(el => {
      if (el.nextElementSibling && el.nextElementSibling.classList.contains('cm-unfold')) return;
      if (el.scrollHeight > el.clientHeight + 2) { const b = document.createElement('button'); b.className = 'link small cm-unfold'; b.textContent = '더 보기'; b.onclick = e => { e.stopPropagation(); el.classList.add('open'); if (el.dataset.fk) S.unfold.add(el.dataset.fk); b.remove(); }; el.after(b); }
    });
  }
  window.PulseCmt = { page, tools, sub, S, list, fold };
})();
