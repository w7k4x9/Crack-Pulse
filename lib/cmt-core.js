// 펄스 댓글 — 백그라운드·대시보드·팝업이 같이 쓰는 계산 (저장된 cmt 객체만 보고 판단)
// 스레드 T: { id, sid, type, work, adult, nick, img, mine, text, at, likes, liked, rc, status, replies:[{id,nick,mine,text,at}], repliedAt, lastOther, done }
(function (root) {
  'use strict';
  const t = s => (s ? Date.parse(s) || 0 : 0);
  const alive = T => T && T.status !== 'deleted' && !T.blind;
  // 답글을 기다리는 스레드: 남이 마지막으로 말했고, 내가 그 뒤에 답하지 않았고, 넘기기도 안 한 것
  function needs(T) {
    if (!alive(T) || !T.lastOther || T.pend) return false;
    if (T.repliedAt && T.repliedAt >= T.lastOther) return false;
    if (T.done && T.done >= T.lastOther) return false;
    return true;
  }
  const isNew = (T, seen) => needs(T) && T.lastOther > (seen || 0);
  // 내 답글 이후(없으면 처음부터) 남이 단 것들 — 무엇에 답해야 하는지
  function pending(T) {
    const after = T.repliedAt || 0;
    const rs = (T.replies || []).filter(r => !r.mine && t(r.at) > after);
    return { top: !T.mine && t(T.at) > after, replies: rs };
  }
  // 질문처럼 보이는 글. "어?", "엥?" 같은 감탄은 빼고 봄
  const isQuestion = s => { const x = String(s || '').replace(/(^|[\s.~!ㅋㅎ])[가-힣ㄱ-ㅎ]{1,2}[?？]+/g, ' '); return /[?？]|궁금|질문|알려\s?주|혹시|어떻게|언제|될까요|있을까요|인가요|있나요|건가요|나요[.!~\s]|까요[.!~\s]|까요$|나요$/.test(x); };
  // 'reply' = 답글이 필요해요 (아직 한 번도 답하지 않았거나, 내 답 뒤에 질문이 왔음)
  // 'react' = 내 답 뒤에 온 반응 (고마워요 같은 말). 읽고 확인만 해도 되는 것
  function level(T) {
    if (!needs(T)) return null;
    if (!T.mine && !T.repliedAt) return 'reply';
    const p = pending(T);
    return p.replies.some(r => isQuestion(r.text)) ? 'reply' : 'react';
  }
  function stats(C) {
    const out = { need: 0, react: 0, fresh: 0, total: 0 };
    if (!C || !C.threads) return out;
    for (const T of Object.values(C.threads)) { if (!alive(T)) continue; out.total++; const lv = level(T); if (!lv) continue; out[lv === 'reply' ? 'need' : 'react']++; if (T.lastOther > (C.seenAt || 0)) out.fresh++; }
    return out;
  }
  const crackUrl = T => `https://crack.wrtn.ai/${T.type === 'character' ? 'characters/' + T.sid + '/detail' : 'detail/' + T.sid}#comment`;
  root.PulseCmtCore = { needs, level, isNew, pending, stats, isQuestion, crackUrl, ts: t };
})(typeof self !== 'undefined' ? self : window);
