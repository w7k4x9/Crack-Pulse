'use strict';
// 업데이트 화면에 나중에 덧붙일 것은 여기에. (update.js는 업데이트로 바뀌지 않음)
// update.js와 같은 전역을 쓰므로 그 안의 함수(resolveFolder, renderPick, renderAvailable …)를 감싸서 고칠 수 있어요.
//
// 1) 기억해 둔 폴더가 옮겨졌거나 지워졌을 때: 크롬이 "A requested file or directory could not be found…"를
//    내고 멈췄음. → 기억을 지우고 폴더를 한 번 다시 고르게 함.
// 2) 고른 폴더에 이미 새 버전이 들어 있을 때(압축을 풀어 덮어썼거나 파일을 직접 넣음): 다시 켜기만 하면 됨.
(() => {
  const isGone = e => e && (e.name === 'NotFoundError' || /could not be found/i.test(String(e.message || e)));
  let gone = false, readyVer = null;
  const forget = async () => { folder = null; await idb.del('folder').catch(() => {}); };

  const origResolve = resolveFolder;
  resolveFolder = async dir => {
    gone = false; readyVer = null;
    let r;
    try { r = await origResolve(dir); }
    catch (e) { if (!isGone(e)) throw e; gone = true; await forget(); return { match: null, others: [] }; }
    const ready = !r.match && info && info.latest && r.others.find(o => o.version === info.latest);
    if (ready) { readyVer = ready.version; await idb.set('folder', dir).catch(() => {}); throw new Error('이미 새 버전이 들어 있어요'); }
    return r;
  };

  const origPick = renderPick;
  renderPick = (warn = '') => origPick(gone ? '전에 기억해 둔 폴더가 옮겨졌거나 없어져서 찾지 못했어요. 지금 펄스가 들어 있는 폴더를 한 번만 다시 골라 주세요.' : warn);

  const origAvail = renderAvailable;
  renderAvailable = (extra = {}) => {
    if (readyVer) {
      const v = readyVer; readyVer = null;
      return show({ title: `새 버전 ${v}`, sub: `지금 쓰는 버전 ${manifest.version}`, notes: info.notes,
        msg: `폴더에는 이미 <b>${esc(v)}</b> 파일이 들어 있어요. 펄스를 다시 켜기만 하면 돼요. 기록과 설정은 그대로예요.`,
        primary: { label: '다시 켜기', onClick: async () => { await chrome.storage.local.set({ [APPLIED]: { from: manifest.version, to: v, at: Date.now(), notes: info.notes || [] } }); chrome.runtime.reload(); } } });
    }
    // 폴더를 찾는 단계가 아닌 곳에서 "없어요"가 나도, 기억한 폴더를 지우고 다시 고르게
    if (!gone && /could not be found/i.test(String(extra.msg || ''))) { gone = true; forget(); return renderPick(); }
    return origAvail(extra);
  };
})();
