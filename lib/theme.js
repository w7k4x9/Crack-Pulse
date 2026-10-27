// 화면 테마: 깜빡임 없이 먼저 적용 (설정의 값은 localStorage에도 복사해 둠)
(function () {
  function apply(t) { const r = document.documentElement; if (t === 'dark' || t === 'light') r.dataset.theme = t; else delete r.dataset.theme; }
  try { apply(localStorage.getItem('hh_theme')); } catch (e) {}
  window.hhApplyTheme = function (t) { apply(t); try { localStorage.setItem('hh_theme', t || 'system'); } catch (e) {} };
})();
