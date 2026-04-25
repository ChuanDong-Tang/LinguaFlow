import { getDomRefs as p } from "./domRefs.js";
import { PlayerController as l } from "./PlayerController.js";
import { PracticeController as u } from "./PracticeController.js";
import {
  tokenizeWords as xe,
  normFillToken as Se,
  normFillAnswer as Ce,
  formatClockSec as we,
} from "./textUtils.js";
import {
  isTypingField as je,
  isSpaceReservedControl as Me,
  isArrowReservedControl as Ne,
  eventTargetElement as Gt,
} from "./runtimeUtils.js";
import { getAudioFacade } from "../../../services/audio/audioFacade";
import { createPracticeAudioFlow } from "../../../services/audio/practiceAudioFlow";
import { renderTextWithKeyPhraseHighlight} from "../../../shared/keyPhraseHighlight";
import { splitTextForSpeech } from "../../../services/audio/providers/webspeech/splitTextForSpeech";

var {
    textEl: inputTextEl,
    btnEl: generatePracticeBtn,
    clearInputBtn: clearPracticeBtn,
    statusEl: statusMessageEl,
    playerEl: mediaEl,
    subtitlesListEl: subtitleListEl,
    loopCheckbox: b,
    loopWholeCheckbox: $e,
    playerPlayBtn: et,
    playerPlayIcon: tt,
    playerTimeDisplay: nt,
    playerSeekEl: rt,
    playerRateEl: it,
    playerPrevBtn: at,
    playerNextBtn: ot,
    practiceModeBarEl: st,
    practicePagerEl: ut,
    practicePagePrevBtn: practicePagePrevBtnEl,
    practicePageNextBtn: practicePageNextBtnEl,
    practicePageIndicator: practicePageIndicatorEl,
    practiceActionsBar: ct,
    fillblankCheckBtn: lt,
    dictationCheckBtn: dictationCheckBtnEl,
    proofreadSaveBtn: dt,
  } = p(),
  cueListMode = `subtitles`,
  selectedProofreadBlankMap = {},
  fillblankSlotStateByKey = {},
  fillblankScoreSummary = null;
function remapFillblankStateKeys(e) {
  let n = {};
  for (let [t, r] of Object.entries(e)) {
    let e = Number(t);
    if (!Number.isFinite(e)) continue;
    let i = [...(Array.isArray(r) ? r : [])]
      .map((e) => Number(e))
      .filter((e) => Number.isFinite(e))
      .sort((e, t) => e - t);
    for (let t = 0; t < i.length; t++) {
      let r = `${e}:${i[t]}`,
        a = `${e}:${t}`,
        o = fillblankSlotStateByKey[a];
      (o === `pending` || o === `wrong` || o === `ok`) &&
        n[r] == null &&
        (n[r] = o);
    }
  }
  fillblankSlotStateByKey = n;
}
var fillblankActiveCueIndex = -1,
  playbackCues = [],
  cueRowEls = [],
  cueInputEls = [],
  cuePageIndexByCue = [],
  keyPhrasesByCue = [],
  practicePageCount = 0,
  activeCueIndex = -1,
  lastPlayedCueIndex = -1,
  practicePageIndex = 0,
  speechActiveCueIndex = -1,
  practiceCaptureItemId = ``;
function setStatusMessage(e) {
  statusMessageEl && (statusMessageEl.textContent = e ?? ``);
}

var playerController = new l({
    playerEl: mediaEl,
    playerTimeDisplay: nt,
    playerSeekEl: rt,
    playerPlayBtn: et,
    playerPlayIcon: tt,
    playerRateEl: it,
    loopWholeCheckbox: $e,
    getPlaybackCues: () => playbackCues,
    getCueListMode: () => cueListMode,
    getCueInputs: () => cueInputEls,
    getCueElements: () => cueRowEls,
    getCueIndexForTime: findCueIndexAtTime,
    applyCuePosition: seekToCueStart,
    seekToCueNoPlay: seekCueNoPlay,
    firstFocusableFillBlankSlot: getFirstFocusableFillblankSlot,
    formatClockSec: we,
  }),
  $t = null,
  practiceAudioFlow = createPracticeAudioFlow({
    getCueByIndex: (e) => playbackCues[e],
    getPlaybackRate: () => parseFloat(it?.value || `1`),
    isCueLoopEnabled: () => !!b?.checked,
    getLastPlayedCueIndex: () => lastPlayedCueIndex,
    setLastPlayedCueIndex: (e) => {
      lastPlayedCueIndex = e;
    },
    onActiveCueChange: (e) => {
      speechActiveCueIndex = Number.isFinite(e) ? e : -1;
      syncPlayerTransportUi();
    },
    onCueInlineStarted: (e) => {
      practicePageIndex = cuePageIndexByCue[e] ?? e;
      renderPracticePager();
      activeCueIndex = e;
      for (let t = 0; t < cueRowEls.length; t++) cueRowEls[t].classList.toggle(`cue-row--active`, t === e);
    },
  });
function collectProofreadSelectionMap() {
  let e = {};
  for (let t = 0; t < playbackCues.length; t++) {
    let n = cueRowEls[t]?.querySelector(`.cue-proofread`);
    if (!n) continue;
    let r = xe(playbackCues[t].text.trim()),
      i = [];
    for (let e = 0; e < r.length; e++) {
      if (!Se(r[e])) continue;
      n
        .querySelector(`.pr-word[data-si="${t}"][data-wi="${e}"]`)
        ?.classList.contains(`pr-word--selected`) && i.push(e);
    }
    i.length && (e[String(t)] = i);
  }
  return e;
}
function applyProofreadSelectionMap(e) {
  for (let [t, n] of Object.entries(e)) {
    let e = Number(t);
    if (!Number.isFinite(e) || !cueRowEls[e]) continue;
    let r = Array.isArray(n) ? n : [];
    for (let t of r)
      Se(xe(playbackCues[e].text.trim())[Number(t)] ?? ``) &&
      cueRowEls[e]
        .querySelector(
          `.cue-proofread .pr-word[data-si="${e}"][data-wi="${t}"]`,
        )
        ?.classList.add(`pr-word--selected`);
  }
}
function buildFillblankSegments(e, t) {
  let n = xe(playbackCues[e].text.trim()),
    r = [],
    i = [],
    a = () => {
      i.length && (r.push({ type: `text`, text: i.join(` `) }), (i = []));
    },
    o = String(e),
    s = new Set(Array.isArray(t[o]) ? t[o] : []);
  for (let e = 0; e < n.length; e++) {
    let t = n[e],
      o = Se(t);
    if (!s.has(e) || !o) {
      i.push(t);
      continue;
    }
    a();
    let c = 0,
      l = t.length;
    for (; c < l && !/[A-Za-z0-9']/.test(t[c]); ) c += 1;
    for (; l > c && !/[A-Za-z0-9']/.test(t[l - 1]); ) l -= 1;
    let u = t.slice(0, c),
      d = t.slice(l);
    r.push({ type: `blank`, answer: o, wordIndex: e, prefix: u, suffix: d });
  }
  return (a(), r);
}
function syncProofreadSelectionMap() {
  selectedProofreadBlankMap = collectProofreadSelectionMap();
}
function collectValidBlankSlotKeys(e, t) {
  let n = e && typeof e == `object` ? e : {};
  if (!Array.isArray(t) || t.length === 0) return [];
  let r = [];
  for (let [e, i] of Object.entries(n)) {
    if (!Array.isArray(i)) continue;
    let n = Number(e);
    if (!Number.isFinite(n) || n < 0 || n >= t.length) continue;
    let a = xe(String(t[n].text ?? ``).trim());
    for (let e of i) {
      let t = Number(e);
      Number.isFinite(t) &&
        t >= 0 &&
        t < a.length &&
        Se(a[t]) &&
        r.push(`${n}:${t}`);
    }
  }
  return r;
}
function updateFillblankScoreSummary() {
  let e = collectValidBlankSlotKeys(selectedProofreadBlankMap, playbackCues);
  if (!e.length) {
    fillblankScoreSummary = null;
    return;
  }
  let t = 0;
  for (let n of e) fillblankSlotStateByKey[n] === `ok` && (t += 1);
  let n = Math.round((t / e.length) * 100);
  fillblankScoreSummary = {
    totalBlanks: e.length,
    correctBlanks: t,
    percent: n,
    tier: Bt(n),
    updatedAt: new Date().toISOString(),
  };
}
function syncFillblankStateFromSlots() {
  cueListMode !== `fillblank` ||
    !playbackCues.length ||
    (subtitleListEl.querySelectorAll(`.fb-slot`).forEach((e) => {
      let t = e.dataset.fbSlotKey;
      t &&
        (e.classList.contains(`fb-slot--ok`)
          ? (fillblankSlotStateByKey[t] = `ok`)
          : e.classList.contains(`fb-slot--wrong`)
            ? (fillblankSlotStateByKey[t] = `wrong`)
            : (fillblankSlotStateByKey[t] = `pending`));
    }));
}
function estimateCueDurationSec(e) {
  let t = String(e || ``).trim();
  if (!t) return 1.1;
  let n = t.split(/\s+/).filter(Boolean).length;
  if (!n) n = Math.max(1, Math.ceil(t.length / 6));
  return Math.min(12, Math.max(1.1, n * 0.56));
}
function buildEstimatedCues(e) {
  let t = 0;
  return e.map((e) => {
    let n = estimateCueDurationSec(e),
      r = { start: t, end: t + n, text: e };
    return (t += n), r;
  });
}
function findCueIndexAtTime(e) {
  let t = 0;
  for (let n = 0; n < playbackCues.length; n++) e + 1e-4 >= playbackCues[n].start && (t = n);
  return t;
}
function findCueIndexAtTimeWithTolerance(e) {
  if (!playbackCues.length) return -1;
  for (let t = 0; t < playbackCues.length; t++) {
    let n = playbackCues[t],
      r = t === playbackCues.length - 1;
    if (e >= n.start && (r ? e <= n.end + 0.08 : e < n.end)) return t;
  }
  for (let t = playbackCues.length - 1; t >= 0; t--) {
    let n = playbackCues[t];
    if (e >= n.start && e <= n.end + 0.12) return t;
  }
  return findCueIndexAtTime(e);
}
function scrollCueIntoView(e) {
  cueRowEls[e]?.scrollIntoView({ block: `center`, behavior: `smooth` });
}
function seekToCueStart(e) {
  playbackCues[e] &&
    ((mediaEl.currentTime = playbackCues[e].start),
    (activeCueIndex = -1),
    syncActiveCueByCurrentTime(mediaEl.currentTime),
    scrollCueIntoView(e));
}
function seekCueNoPlay(e) {
  playbackCues[e] && (mediaEl.pause(), seekToCueStart(e));
}
function clearSpeechLoopTimer() {
  practiceAudioFlow.clearLoopTimer();
}
function stopPracticeSpeechPlayback({ invalidateLoop: e = !0 } = {}) {
  practiceAudioFlow.stop({ invalidateLoop: e });
}
function getFirstFocusableFillblankSlot(e) {
  if (!e) return null;
  let t = e.querySelectorAll(`.fb-slot`);
  for (let e of t) if (!e.readOnly) return e;
  return t[0] ?? null;
}
function seekToNextCue() {
  if (!playbackCues.length) return;
  if (!mediaEl.src) {
    let e = getFocusedCueIndex();
    e >= 0 && e < playbackCues.length || (e = Math.max(0, findCueIndexAtTime(mediaEl.currentTime)));
    playCueInline(Math.min(playbackCues.length - 1, e + 1));
    return;
  }
  let e = findCueIndexAtTime(mediaEl.currentTime);
  seekCueNoPlay(Math.min(playbackCues.length - 1, e + 1));
}
function seekToPreviousCue() {
  if (!playbackCues.length) return;
  if (!mediaEl.src) {
    let e = getFocusedCueIndex();
    e >= 0 && e < playbackCues.length || (e = Math.max(0, findCueIndexAtTime(mediaEl.currentTime)));
    playCueInline(Math.max(0, e - 1));
    return;
  }
  let e = findCueIndexAtTime(mediaEl.currentTime);
  seekCueNoPlay(Math.max(0, e - 1));
}
function toggleMainPlayerPlayback() {
  if (!mediaEl.src) {
    if (!playbackCues.length) return;
    if (speechActiveCueIndex >= 0) {
      stopPracticeSpeechPlayback();
      return;
    }
    let e = getFocusedCueIndex();
    e >= 0 && e < playbackCues.length || (e = Math.max(0, findCueIndexAtTime(mediaEl.currentTime)));
    playCueInline(e);
    return;
  }
  if (mediaEl.paused) {
    mediaEl.play().catch(() => {});
    return;
  }
  mediaEl.pause();
}
function playCueInline(e) {
  mediaEl.pause();
  practiceAudioFlow.playCueInline(e);
}
function clampPracticePageIndex() {
  if (!practicePageCount) {
    practicePageIndex = 0;
    return;
  }
  practicePageIndex = Math.max(0, Math.min(practicePageCount - 1, practicePageIndex));
}
function findFirstCueIndexInPage(e) {
  for (let t = 0; t < cuePageIndexByCue.length; t++) if ((cuePageIndexByCue[t] ?? 0) === e) return t;
  return -1;
}
function renderPracticePager() {
  clampPracticePageIndex();
  let e = practicePageCount > 0;
  ut && (ut.hidden = !e);
  if (practicePageIndicatorEl) practicePageIndicatorEl.textContent = e ? `${practicePageIndex + 1} / ${practicePageCount}` : `0 / 0`;
  practicePagePrevBtnEl && (practicePagePrevBtnEl.disabled = !e || practicePageIndex <= 0);
  practicePageNextBtnEl && (practicePageNextBtnEl.disabled = !e || practicePageIndex >= practicePageCount - 1);
  for (let t = 0; t < cueRowEls.length; t++)
    cueRowEls[t].classList.toggle(`cue-row--paged-hidden`, (cuePageIndexByCue[t] ?? 0) !== practicePageIndex);
}
function goToPracticePage(e, { focusDictation: t = !1 } = {}) {
  if (!practicePageCount) return;
  practicePageIndex = e;
  renderPracticePager();
  let n = findFirstCueIndexInPage(practicePageIndex);
  if (n < 0) return;
  let r = cueRowEls[n];
  r?.scrollIntoView({ block: `nearest`, behavior: `smooth` });
  if (cueListMode === `dictation`) {
    (activeCueIndex = n),
      cueRowEls.forEach((e, t) => e.classList.toggle(`cue-row--active`, t === n)),
      t && cueInputEls[n]?.focus({ preventScroll: !0 });
  }
}
function syncPlayerTransportUi() {
  playerController.syncPlayerTransport();
  if (!et || !tt || mediaEl.src) return;
  let e = speechActiveCueIndex >= 0;
  tt.textContent = e ? `⏸` : `▶`;
  let t = et.querySelector(`.player-play-label`);
  t && (t.textContent = e ? `暂停` : `播放`);
  et.setAttribute(`aria-label`, e ? `暂停` : `播放`);
  et.setAttribute(`aria-pressed`, e ? `true` : `false`);
}
function resetPlayerTransportUi() {
  playerController.resetPlayerTransportOptions();
}
function clearPeekUiTimers() {
  cueRowEls.forEach((e) => {
    (e.querySelector(`.cue-peek`)?.classList.remove(`cue-peek--visible`),
      e
        .querySelector(`.fb-peek-hint`)
        ?.classList.remove(`fb-peek-hint--visible`));
  });
}
function syncPracticeActionButtons() {
  let e = playbackCues.length > 0,
    t = cueListMode;
  if (!ct) return;
  let n = e && t === `proofread`,
    r = e && t === `fillblank`,
    i = e && t === `dictation`;
  (dt && (dt.hidden = !n),
    lt && (lt.hidden = !r),
    dictationCheckBtnEl && (dictationCheckBtnEl.hidden = !i),
    (ct.hidden = !n && !r && !i));
}
async function persistStatusPageOnly(e) {
  setStatusMessage(e);
  return { outcome: `page-only` };
}
async function saveProofreadSelection() {
  if (cueListMode !== `proofread` || !playbackCues.length) return;
  (syncProofreadSelectionMap(),
    remapFillblankStateKeys(selectedProofreadBlankMap),
    (fillblankScoreSummary = null),
    await persistStatusPageOnly(`已确认创建。`),
    emitPracticeBlankIndexesUpdate(),
    switchToFillblankMode());
}
function emitPracticeBlankIndexesUpdate() {
  let e = practiceCaptureItemId || inputTextEl.dataset.practiceCaptureItemId || ``;
  if (!e) return;
  let t = Array.isArray(selectedProofreadBlankMap?.[0]) ? selectedProofreadBlankMap[0] : [],
    n = Array.from(
      new Set(
        t.map((e) => Number(e))
          .filter((e) => Number.isFinite(e) && e >= 0)
          .map((e) => Math.floor(e)),
      ),
    ).sort((e, t) => e - t);
  document.dispatchEvent(
    new CustomEvent(`daily-capture-practice-blanks-updated`, {
      detail: { itemId: e, blankIndexes: n },
    }),
  );
}
function markFillblankReviewResult() {
  (subtitleListEl.classList.add(`oio-fillblank-reviewed`),
    subtitleListEl.querySelectorAll(`.fb-slot`).forEach((e) => {
      if (e.dataset.fbRevealed === `1`) {
        (e.classList.remove(`fb-slot--wrong`), e.classList.add(`fb-slot--ok`));
        return;
      }
      e.classList.remove(`fb-slot--wrong`, `fb-slot--ok`);
      let t = e.dataset.answer ?? ``,
        n = e.value,
        r = Ce(n),
        i = Ce(t);
      (r === `` || r !== i
        ? e.classList.add(`fb-slot--wrong`)
        : e.classList.add(`fb-slot--ok`));
    }));
}
function renderProofreadSelectionRows() {
  for (let e = 0; e < playbackCues.length; e++) {
    let t = cueRowEls[e]?.querySelector(`.cue-proofread`);
    if (!t) continue;
    t.replaceChildren();
    let r = document.createElement(`div`);
    ((r.className = `pr-ref-line`),
      xe(playbackCues[e].text.trim()).forEach((t, n) => {
        n > 0 && r.appendChild(document.createTextNode(` `));
        let i = document.createElement(`span`);
        ((i.className = `pr-word`),
          (i.dataset.si = String(e)),
          (i.dataset.wi = String(n)),
          Se(t)
            ? (i.dataset.blankable = `1`)
            : i.classList.add(`pr-word--locked`),
          (i.textContent = t),
          r.appendChild(i));
      }),
      t.appendChild(r));
  }
}
function renderFillblankCueRow(e, t) {
  let n = cueRowEls[e]?.querySelector(`.cue-fillblank`);
  if (!n) return;
  n.replaceChildren();
  let r = document.createElement(`div`);
  r.className = `fb-line`;
  let i = document.createElement(`div`);
  ((i.className = `fb-flow`),
    t.forEach((t, n) => {
      if (
        (n > 0 && i.appendChild(document.createTextNode(` `)),
        t.type === `text`)
      ) {
        let r = document.createElement(`span`);
        ((r.className = `fb-text`),
          (r.innerHTML = renderTextWithKeyPhraseHighlight(t.text, keyPhrasesByCue[e] ?? [])),
          i.appendChild(r));
      } else {
        let r = Number(t.wordIndex),
          a = Number.isFinite(r) ? `${e}:${r}` : `${e}:${n}`,
          o = document.createElement(`span`);
        o.className = `fb-slot-wrap`;
        let s = document.createElement(`input`);
        ((s.type = `text`),
          (s.className = `fb-slot`),
          (s.autocomplete = `off`),
          (s.spellcheck = !1),
          (s.placeholder = `____`),
          s.setAttribute(`aria-label`, `练习填空`));
        let c = t.answer.length,
          l = Math.min(18, Math.max(c + 1, 3));
        ((s.style.width = `${l}ch`),
          (s.style.boxSizing = `border-box`),
          (s.dataset.answer = t.answer),
          (s.dataset.fbSlotKey = a));
        let u = fillblankSlotStateByKey[a];
        (u === `ok`
          ? (s.classList.add(`fb-slot--ok`, `fb-slot--revealed`),
            (s.dataset.fbRevealed = `1`),
            (s.readOnly = !0),
            (s.value = t.answer))
          : u === `wrong` && s.classList.add(`fb-slot--wrong`),
          s.addEventListener(`click`, (e) => e.stopPropagation()));
        let d = document.createElement(`span`);
        t.prefix &&
          (() => {
            let e = document.createElement(`span`);
            ((e.className = `fb-punct`), (e.textContent = t.prefix), o.appendChild(e));
          })();
        ((d.className = `fb-slot-actions`),
          d.setAttribute(`role`, `group`),
          d.setAttribute(`aria-label`, `填空帮助`));
        let f = document.createElement(`button`);
        ((f.type = `button`),
          (f.className = `fb-help-btn`),
          (f.textContent = `帮填`),
          f.setAttribute(`aria-label`, `帮我填写这个单词`),
          (f.title = `帮我填写这个单词`),
          f.addEventListener(`mousedown`, (e) => {
            e.stopPropagation();
          }),
          f.addEventListener(`click`, (e) => {
            if (!subtitleListEl.classList.contains(`oio-fillblank-reviewed`)) return;
            (e.preventDefault(),
              e.stopPropagation(),
              (s.value = s.dataset.answer ?? ``),
              s.classList.remove(`fb-slot--wrong`),
              s.classList.add(`fb-slot--ok`),
              (s.readOnly = !1),
              delete s.dataset.fbRevealed,
              s.classList.remove(`fb-slot--revealed`),
              syncFillblankStateFromSlots(),
              updateFillblankScoreSummary());
          }),
          d.appendChild(f),
          o.appendChild(s),
          t.suffix &&
            (() => {
              let e = document.createElement(`span`);
              ((e.className = `fb-punct`), (e.textContent = t.suffix), o.appendChild(e));
            })(),
          o.appendChild(d),
          i.appendChild(o));
      }
    }),
    r.appendChild(i),
    n.appendChild(r));
}
function switchToProofreadMode() {
  if (!playbackCues.length) return;
  (mediaEl.pause(), clearPeekUiTimers());
  let e = document.activeElement;
  (e?.classList?.contains(`cue-input`) && e.blur(),
    renderProofreadSelectionRows(),
    applyProofreadSelectionMap(selectedProofreadBlankMap),
    syncProofreadSelectionMap(),
    (cueListMode = `proofread`),
    refreshPracticeUI(),
    refreshPracticeModeButtons());
}
function switchToFillblankMode() {
  if (playbackCues.length) {
    if (
      (clearPeekUiTimers(),
      subtitleListEl.classList.remove(`oio-fillblank-reviewed`),
      cueListMode === `proofread` && syncProofreadSelectionMap(),
      !(collectValidBlankSlotKeys(selectedProofreadBlankMap, playbackCues).length > 0))
    ) {
      setStatusMessage(`还没有可练习的填空。请先进入「创建填空」选择要挖空的词。`);
      return;
    }
    remapFillblankStateKeys(selectedProofreadBlankMap);
    for (let e = 0; e < playbackCues.length; e++) renderFillblankCueRow(e, buildFillblankSegments(e, selectedProofreadBlankMap));
    ((cueListMode = `fillblank`),
      !mediaEl.paused && playbackCues.length && (fillblankActiveCueIndex = findCueIndexAtTimeWithTolerance(mediaEl.currentTime)),
      refreshPracticeUI(),
      refreshPracticeModeButtons());
  }
}
function switchToSubtitlesMode() {
  (cueListMode === `proofread` && syncProofreadSelectionMap(), (cueListMode = `subtitles`), clearPeekUiTimers(), refreshPracticeUI(), refreshPracticeModeButtons());
}
function switchToDictationMode() {
  (cueListMode === `proofread` && syncProofreadSelectionMap(), (cueListMode = `dictation`), refreshPracticeUI(), refreshPracticeModeButtons());
}
function updatePracticeModeButtons() {
  st &&
    st.querySelectorAll(`[data-set-practice-mode]`).forEach((e) => {
      let t = e.dataset.setPracticeMode;
      (e.classList.toggle(`practice-mode-btn--collectProofreadSelectionMap`, t === cueListMode),
        (e.disabled = !playbackCues.length));
    });
}
function getFocusedCueIndex() {
  let e = document.activeElement;
  if (e?.classList?.contains(`cue-input`)) {
    let t = e.closest(`.cue-row`);
    if (t?.dataset.idx != null) return Number(t.dataset.idx);
  }
  if (e?.classList?.contains(`fb-slot`)) {
    let t = e.closest(`.cue-row`);
    if (t?.dataset.idx != null) return Number(t.dataset.idx);
  }
  return activeCueIndex >= 0 ? activeCueIndex : findCueIndexAtTime(mediaEl.currentTime);
}
function syncSubtitlePracticeUI() {
  let e = cueListMode !== `subtitles`;
  (cueRowEls.forEach((t, n) => {
    let r = t.querySelector(`.cue-reference`),
      i = cueInputEls[n],
      a = t.querySelector(`.cue-peek`),
      o = t.querySelector(`.cue-proofread`),
      s = t.querySelector(`.cue-fillblank`),
      c = t.querySelector(`.cue-inline-play`);
    if (!e) {
      (r.classList.remove(`cue-reference--hidden`),
        i.classList.remove(`cue-input--visible`),
        a.classList.remove(`cue-peek--visible`),
        c?.classList.add(`cue-inline-play--hidden`),
        o?.classList.add(`cue-proofread--hidden`),
        s?.classList.add(`cue-fillblank--hidden`));
      return;
    }
    (r.classList.add(`cue-reference--hidden`),
      o?.classList.toggle(`cue-proofread--hidden`, cueListMode !== `proofread`),
      s?.classList.toggle(`cue-fillblank--hidden`, cueListMode !== `fillblank`));
    let l = cueListMode === `dictation`;
    (i.classList.toggle(`cue-input--visible`, l),
      c?.classList.remove(`cue-inline-play--hidden`));
  }),
    e || clearPeekUiTimers(),
    syncPracticeActionButtons(),
    cueListMode !== `fillblank` && (fillblankActiveCueIndex = -1),
    st && ((st.hidden = !playbackCues.length), refreshPracticeModeButtons()),
    renderPracticePager());
}
function refreshPracticeModeButtons() {
  return updatePracticeModeButtons();
}
function refreshPracticeUI() {
  return syncSubtitlePracticeUI();
}
function goPracticeSubtitles() {
  return $t ? $t.goPracticeSubtitles() : switchToSubtitlesMode();
}
function goPracticeDictation() {
  return $t ? $t.goPracticeDictation() : switchToDictationMode();
}
function setPracticeCues(e, { cueCardIndexList: t = null, cardCount: n = null } = {}) {
  let r = Array.isArray(t) && t.length === e.length ? t : e.map((e, t) => t),
    i =
      Number.isFinite(n) && n > 0
        ? Math.max(1, Math.floor(n))
        : (r.length ? Math.max(...r) + 1 : 0);
  (!Array.isArray(keyPhrasesByCue) || keyPhrasesByCue.length !== e.length) && (keyPhrasesByCue = e.map(() => []));
  ((playbackCues = e),
    (cuePageIndexByCue = r),
    (practicePageCount = i),
    (activeCueIndex = -1),
    (lastPlayedCueIndex = -1),
    (practicePageIndex = 0),
    clearPeekUiTimers(),
    (fillblankSlotStateByKey = {}),
    (fillblankScoreSummary = null),
    subtitleListEl.classList.remove(`oio-fillblank-reviewed`),
    (subtitleListEl.innerHTML = ``),
    (cueRowEls = []),
    (cueInputEls = []),
    e.forEach((e, t) => {
      let n = document.createElement(`div`);
      ((n.className = `cue-row`), (n.dataset.idx = String(t)));
      let i = document.createElement(`p`);
      ((i.className = `cue cue-reference`),
        (i.innerHTML = renderTextWithKeyPhraseHighlight(e.text, keyPhrasesByCue[t] ?? [])),
        i.addEventListener(`click`, (e) => {
          (e.stopPropagation(),
            (practicePageIndex = cuePageIndexByCue[t] ?? t),
            renderPracticePager(),
            (activeCueIndex = t),
            cueRowEls.forEach((e, n) => e.classList.toggle(`cue-row--active`, n === t)),
            playCueInline(t));
        }));
      let a = document.createElement(`textarea`);
      ((a.className = `cue-input`),
        (a.rows = 2),
        (a.placeholder = `听写输入…`),
        a.setAttribute(`aria-label`, `听写输入`),
        (a.spellcheck = !1),
        a.addEventListener(`click`, (e) => e.stopPropagation()));
      let o = document.createElement(`div`);
      ((o.className = `cue-peek`), o.setAttribute(`aria-hidden`, `true`));
      let s = document.createElement(`div`);
      s.className = `cue-proofread cue-proofread--hidden`;
      let c = document.createElement(`div`);
      ((c.className = `cue-fillblank cue-fillblank--hidden`),
        n.appendChild(i),
        n.appendChild(a),
        n.appendChild(o),
        n.appendChild(s),
        n.appendChild(c),
        n.addEventListener(`click`, (e) => {
          cueListMode !== `subtitles` &&
            (Gt(e)?.closest?.(`.fb-slot-actions`) ||
              ((practicePageIndex = cuePageIndexByCue[t] ?? t),
              renderPracticePager(),
              (activeCueIndex = t),
              cueRowEls.forEach((e, n) => e.classList.toggle(`cue-row--active`, n === t)),
              (cueListMode === `proofread` || cueListMode === `fillblank`) && playCueInline(t)));
        }),
        subtitleListEl.appendChild(n),
        cueRowEls.push(n),
        cueInputEls.push(a));
    }),
    (cueListMode = `subtitles`),
    refreshPracticeUI());
}
function syncActiveCueByCurrentTime(e) {
  if (!playbackCues.length || !cueRowEls.length) return;
  let t = -1;
  if (cueListMode === `fillblank` && mediaEl.paused && fillblankActiveCueIndex >= 0 && fillblankActiveCueIndex < playbackCues.length) {
    let n = fillblankActiveCueIndex,
      r = playbackCues[n];
    r && e + 1e-4 >= r.end - 0.1 && (t = n);
  }
  if (t < 0)
    for (let n = 0; n < playbackCues.length; n++) {
      let r = playbackCues[n],
        i = n === playbackCues.length - 1;
      if (e >= r.start && (i ? e <= r.end + 0.08 : e < r.end)) {
        t = n;
        break;
      }
    }
  if (t !== activeCueIndex) {
    for (let e = 0; e < cueRowEls.length; e++)
      cueRowEls[e].classList.toggle(`cue-row--active`, e === t);
    activeCueIndex = t;
  }
}
(mediaEl.addEventListener(`timeupdate`, () => {
  let e = mediaEl.currentTime,
    t = cueListMode === `fillblank`;
  if (t && !mediaEl.paused && playbackCues.length > 0 && fillblankActiveCueIndex >= 0 && fillblankActiveCueIndex < playbackCues.length) {
    let t = playbackCues[fillblankActiveCueIndex];
    if (t && e >= t.end - 0.06) {
      mediaEl.pause();
      return;
    }
  }
  ((!mediaEl.paused || e > 0) && syncActiveCueByCurrentTime(e), syncPlayerTransportUi());
}),
  mediaEl.addEventListener(`play`, () => {
    if (cueListMode === `fillblank` && playbackCues.length) {
      let e = mediaEl.currentTime,
        t = fillblankActiveCueIndex;
      if (t >= 0 && t < playbackCues.length) {
        let n = playbackCues[t];
        fillblankActiveCueIndex = n && e + 1e-4 >= n.end - 0.12 ? t : findCueIndexAtTimeWithTolerance(e);
      } else fillblankActiveCueIndex = findCueIndexAtTimeWithTolerance(e);
    }
    (syncActiveCueByCurrentTime(mediaEl.currentTime), syncPlayerTransportUi());
  }),
  mediaEl.addEventListener(`pause`, () => {
    (stopPracticeSpeechPlayback(), syncPlayerTransportUi());
  }),
  mediaEl.addEventListener(`loadedmetadata`, () => {
    syncPlayerTransportUi();
  }),
  mediaEl.addEventListener(`durationchange`, () => {
    syncPlayerTransportUi();
  }),
  mediaEl.addEventListener(`ended`, () => {
    (stopPracticeSpeechPlayback(), syncPlayerTransportUi());
  }),
  mediaEl.addEventListener(`seeked`, () => {
    (cueListMode === `fillblank` && playbackCues.length && (fillblankActiveCueIndex = findCueIndexAtTimeWithTolerance(mediaEl.currentTime)),
      (activeCueIndex = -1),
      syncActiveCueByCurrentTime(mediaEl.currentTime),
      (mediaEl.paused || !playbackCues.length) && stopPracticeSpeechPlayback(),
      syncPlayerTransportUi());
  }),
  b?.addEventListener(`change`, () => {
    practiceAudioFlow.onCueLoopToggleChanged(!!b?.checked);
  }),
  $e?.addEventListener(`change`, () => {
    mediaEl.loop = !!$e.checked;
  }),
  et?.addEventListener(`click`, () => {
    toggleMainPlayerPlayback();
  }),
  at?.addEventListener(`click`, () => {
    seekToPreviousCue();
  }),
  ot?.addEventListener(`click`, () => {
    seekToNextCue();
  }),
  it?.addEventListener(`change`, () => {
    let e = parseFloat(it.value);
    Number.isFinite(e) && ((mediaEl.playbackRate = e), getAudioFacade().setPlaybackRate(e));
  }),
  practicePagePrevBtnEl?.addEventListener(`click`, () => {
    playbackCues.length && goToPracticePage(practicePageIndex - 1, { focusDictation: cueListMode === `dictation` });
  }),
  practicePageNextBtnEl?.addEventListener(`click`, () => {
    playbackCues.length && goToPracticePage(practicePageIndex + 1, { focusDictation: cueListMode === `dictation` });
  }),
  rt?.addEventListener(`pointerdown`, () => {
    playerController.setSeekDragging(!0);
  }),
  rt?.addEventListener(`pointerup`, () => {
    (playerController.setSeekDragging(!1), syncPlayerTransportUi());
  }),
  rt?.addEventListener(`pointercancel`, () => {
    playerController.setSeekDragging(!1);
  }),
  rt?.addEventListener(`input`, () => {
    let e = mediaEl.duration;
    !Number.isFinite(e) ||
      e <= 0 ||
      !rt ||
      (mediaEl.currentTime = (Number(rt.value) / 1e3) * e);
  }),
  document.querySelectorAll(`[data-oio-help]`).forEach((e) => {
    e.addEventListener(`click`, (t) => {
      (t.preventDefault(), t.stopPropagation());
      let n = e.closest(`.oio-help-anchor`);
      if (!n) return;
      let r = !n.classList.contains(`oio-help-open`);
      (document
        .querySelectorAll(`.oio-help-anchor.oio-help-open`)
        .forEach((e) => {
          e !== n && e.classList.remove(`oio-help-open`);
        }),
        n.classList.toggle(`oio-help-open`, r));
    });
  }),
  document.addEventListener(`click`, (e) => {
    e.target.closest(`.oio-help-anchor`) ||
      document
        .querySelectorAll(`.oio-help-anchor.oio-help-open`)
        .forEach((e) => e.classList.remove(`oio-help-open`));
  }),
  st &&
    st.addEventListener(`click`, (e) => {
      let t = e.target.closest(`[data-set-practice-mode]`);
      if (!t || !st.contains(t)) return;
      let n = t.dataset.setPracticeMode;
      n === `subtitles`
        ? goPracticeSubtitles()
        : n === `dictation`
          ? goPracticeDictation()
          : n === `proofread`
            ? switchToProofreadMode()
            : n === `fillblank` && switchToFillblankMode();
    }),
  subtitleListEl.addEventListener(`click`, (e) => {
    let t = Gt(e)?.closest?.(`.pr-word`);
    !t ||
      t.dataset.blankable !== `1` ||
      !subtitleListEl.contains(t) ||
      (e.stopPropagation(),
      t.classList.toggle(`pr-word--selected`),
      cueListMode === `proofread` &&
        ((practicePageIndex = cuePageIndexByCue[Number(t.dataset.si)] ?? Number(t.dataset.si)),
        renderPracticePager(),
        (activeCueIndex = Number(t.dataset.si)),
        cueRowEls.forEach((e, n) => e.classList.toggle(`cue-row--active`, n === Number(t.dataset.si))),
        syncProofreadSelectionMap(),
        playCueInline(Number(t.dataset.si))));
  }),
  lt?.addEventListener(`click`, () => {
    checkFillblankAnswers().catch((e) => {
      (console.error(e), setStatusMessage(`记录填空正确率失败，请稍后再试。`));
    });
  }),
  dictationCheckBtnEl?.addEventListener(`click`, () => {
    checkDictationAnswers();
  }));
async function checkFillblankAnswers() {
  (markFillblankReviewResult(), syncFillblankStateFromSlots(), updateFillblankScoreSummary());
  let e = fillblankScoreSummary;
  await persistStatusPageOnly(
    e
      ? `填空已校对（${e.correctBlanks}/${e.totalBlanks}，${e.percent}%）。`
      : `填空已校对。`,
  );
}
function normalizeDictationText(e) {
  return xe(String(e || ``))
    .map((e) => Se(e))
    .filter(Boolean)
    .join(` `);
}
function checkDictationAnswers() {
  if (cueListMode !== `dictation` || !playbackCues.length) return;
  let e = 0;
  for (let t = 0; t < playbackCues.length; t++) {
    let n = cueInputEls[t];
    if (!n) continue;
    let r = normalizeDictationText(playbackCues[t]?.text || ``),
      i = normalizeDictationText(n.value || ``),
      a = !!i && i === r;
    (n.classList.toggle(`cue-input--ok`, a),
      n.classList.toggle(`cue-input--wrong`, !a),
      a && e++);
  }
  let t = Math.round((e / Math.max(1, playbackCues.length)) * 100);
  setStatusMessage(`听写已检查（${e}/${playbackCues.length}，${t}%）。`);
}
(dt?.addEventListener(`click`, () => {
    saveProofreadSelection().catch((e) => {
      (console.error(e), setStatusMessage(`确认创建失败，请稍后再试。`));
    });
  }),
  subtitleListEl.addEventListener(`input`, (e) => {
    let t = e.target;
    (t?.classList?.contains(`fb-slot`) &&
      (t.readOnly || t.classList.remove(`fb-slot--wrong`, `fb-slot--ok`)),
      t?.classList?.contains(`cue-input`) &&
        t.classList.remove(`cue-input--ok`, `cue-input--wrong`));
  }),
  subtitleListEl.addEventListener(`focusin`, (e) => {
    let t = e.target;
    if (!playbackCues.length) return;
    if (t?.classList?.contains(`fb-slot`)) {
      if (cueListMode !== `fillblank`) return;
      let e = t.closest(`.cue-row`),
        n = e?.dataset.idx == null ? -1 : Number(e.dataset.idx);
      if (n < 0) return;
      (practicePageIndex = cuePageIndexByCue[n] ?? n), renderPracticePager();
      (activeCueIndex = n),
        cueRowEls.forEach((e, t) => {
          e.classList.toggle(`cue-row--active`, t === n);
        }),
        playCueInline(n);
      return;
    }
    if (t?.classList?.contains(`cue-input`) && cueListMode === `dictation`) {
      let e = t.closest(`.cue-row`),
        n = e?.dataset.idx == null ? -1 : Number(e.dataset.idx);
      if (n < 0) return;
      (practicePageIndex = cuePageIndexByCue[n] ?? n), renderPracticePager();
      (activeCueIndex = n),
        cueRowEls.forEach((e, t) => {
          e.classList.toggle(`cue-row--active`, t === n);
        }),
        playCueInline(n);
    }
  }),
  document.addEventListener(`keydown`, (e) => {
    if (e.repeat) return;
    let t = e.target?.classList?.contains(`cue-input`),
      n = e.target?.classList?.contains(`fb-slot`),
      r = cueListMode !== `subtitles`;
    if (n && e.code === `Tab` && cueListMode === `fillblank`) {
      if (!playbackCues.length) return;
      (e.preventDefault(), e.stopPropagation());
      let t = [...subtitleListEl.querySelectorAll(`.fb-slot`)].filter((e) => !e.readOnly),
        n = e.target,
        r = t.indexOf(n);
      if (r < 0) return;
      let i = e.shiftKey ? r - 1 : r + 1;
      if (i < 0 || i >= t.length) return;
      let a = t[i],
        o = Number(n.closest(`.cue-row`)?.dataset.idx),
        s = Number(a.closest(`.cue-row`)?.dataset.idx);
      (o !== s && seekCueNoPlay(s), a.focus({ preventScroll: !0 }));
      return;
    }
    if ((t || n) && e.ctrlKey) {
      if (e.code === `ArrowUp`) {
        if (!e.shiftKey) return;
        (e.preventDefault(), e.stopPropagation(), toggleMainPlayerPlayback());
        return;
      }
      if (e.code === `ArrowLeft`) {
        if (!playbackCues.length) return;
        (e.preventDefault(), e.stopPropagation(), seekToPreviousCue());
        return;
      }
      if (e.code === `ArrowRight`) {
        if (!playbackCues.length) return;
        (e.preventDefault(), e.stopPropagation(), seekToNextCue());
        return;
      }
    }
    let i = je(e.target, inputTextEl),
      a = e.ctrlKey || e.altKey;
    if (e.code === `Space`) {
      if (Me(e.target) || t || n || (i && !a) || !playbackCues.length) return;
      (e.preventDefault(), toggleMainPlayerPlayback());
      return;
    }
    if (e.code === `ArrowRight` || e.code === `ArrowLeft`) {
      if (t || n || (i && !a) || Ne(e.target) || !playbackCues.length) return;
      (e.preventDefault(), e.code === `ArrowRight` ? seekToNextCue() : seekToPreviousCue());
    }
  }),
  generatePracticeBtn.addEventListener(`click`, async () => {
    let e = inputTextEl.value.trim();
    if (!e) {
      setStatusMessage(`请先粘贴或输入英文文本。`);
      return;
    }
    let n2 = inputTextEl.dataset.practiceOpeningHint === `daily`;
    practiceCaptureItemId = n2 ? String(inputTextEl.dataset.practiceCaptureItemId || ``).trim() : ``;
    setStatusMessage(`正在生成练习...`);
    let t = [],
      n = [],
      r2 = [],
      i2 = [];
    try {
      n = JSON.parse(inputTextEl.dataset.practiceCardChunks || `[]`);
    } catch {
      n = [];
    }
    try {
      r2 = JSON.parse(inputTextEl.dataset.practiceCardKeyPhrases || `[]`);
    } catch {
      r2 = [];
    }
    try {
      i2 = JSON.parse(inputTextEl.dataset.practiceBlankIndexes || `[]`);
    } catch {
      i2 = [];
    }
    let r = Array.isArray(n) && n.length > 0 ? n.map((e) => String(e || ``).trim()).filter(Boolean) : [e],
      i = [],
      a = [];
    r.forEach((e, t) => {
      let n = splitTextForSpeech(e);
      n.length || (n = [e]);
      n.forEach((e) => {
        i.push(e);
        a.push(t);
      });
    });
    i.length || ((i = [e]), (a = [0]));
    keyPhrasesByCue = i.map((e, t) => {
      let n = a[t] ?? 0,
        r = Array.isArray(r2?.[n]) ? r2[n] : [];
      return r
        .map((e) => String(e ?? ``).trim())
        .filter(Boolean);
    });
    t = i;
    generatePracticeBtn.disabled = !0;
    try {
      ((playbackCues = []),
        (cuePageIndexByCue = []),
        (practicePageCount = 0),
        (cueRowEls = []),
        (cueInputEls = []),
        (activeCueIndex = -1),
        b && (b.checked = !1),
        resetPlayerTransportUi(),
        (cueListMode = `subtitles`),
        (selectedProofreadBlankMap = {}),
        (fillblankSlotStateByKey = {}),
        clearPeekUiTimers(),
        syncPracticeActionButtons(),
        subtitleListEl.classList.remove(`oio-fillblank-reviewed`),
        (subtitleListEl.innerHTML = ``),
        mediaEl.pause(),
        stopPracticeSpeechPlayback(),
        mediaEl.removeAttribute(`src`),
        mediaEl.load());
      if (Array.isArray(i2) && i2.length > 0) {
        let e = Array.from(
          new Set(
            i2
              .map((e) => Number(e))
              .filter((e) => Number.isFinite(e) && e >= 0)
              .map((e) => Math.floor(e)),
          ),
        ).sort((e, t) => e - t);
        e.length && (selectedProofreadBlankMap = { 0: e });
      }
      let o = buildEstimatedCues(t);
      (setPracticeCues(o, { cueCardIndexList: a, cardCount: Math.max(1, r.length) }),
        syncPlayerTransportUi());
      let l = getAudioFacade(),
        c = l.getActiveProviderId(),
        d = [],
        h = [],
        p = new Set();
      t.forEach((e) => {
        let n = String(e ?? ``).trim();
        if (!n || p.has(n)) return;
        p.add(n), d.push(n);
      });
      if (d.length) {
        (setStatusMessage(`正在预加载语音（${d.length} 句）...`), (h = [c]));
        let e = await l.prefetchTexts(d);
        if (!e && c === `kokoro`) {
          (setStatusMessage(`Kokoro 预加载失败，正在切换到 Web Speech...`),
            (await l.switchProvider(`web`)) && ((c = l.getActiveProviderId()), h.push(c), (e = await l.prefetchTexts(d))));
        }
      }
      let g = l.getActiveProviderId() === `kokoro` ? `Kokoro` : `Web Speech`,
        m = h.length > 1 ? `（本次已自动回退到 Web Speech）` : ``;
      setStatusMessage(`完成。共 ${r.length} 张卡片，${t.length} 句。当前语音源：${g}${m}。`);
    } catch (e) {
      (console.error(e),
        setStatusMessage(
          e?.message
            ? `出错：${e.message}`
            : `生成失败，请打开控制台查看详情。`,
        ));
    } finally {
      delete inputTextEl.dataset.practiceCardChunks;
      delete inputTextEl.dataset.practiceCardKeyPhrases;
      delete inputTextEl.dataset.practiceCaptureItemId;
      delete inputTextEl.dataset.practiceBlankIndexes;
      delete inputTextEl.dataset.practiceOpeningHint;
      generatePracticeBtn.disabled = !1;
    }
  }),
  clearPracticeBtn?.addEventListener(`click`, () => {
    ((inputTextEl.value = ``),
      (practiceCaptureItemId = ``),
      delete inputTextEl.dataset.practiceCardChunks,
      delete inputTextEl.dataset.practiceCardKeyPhrases,
      delete inputTextEl.dataset.practiceCaptureItemId,
      delete inputTextEl.dataset.practiceBlankIndexes,
      delete inputTextEl.dataset.practiceOpeningHint,
      setStatusMessage(``),
      (playbackCues = []),
      (cuePageIndexByCue = []),
      (keyPhrasesByCue = []),
      (practicePageCount = 0),
      (cueRowEls = []),
      (cueInputEls = []),
      (activeCueIndex = -1),
      b && (b.checked = !1),
      resetPlayerTransportUi(),
      (cueListMode = `subtitles`),
      (selectedProofreadBlankMap = {}),
      (fillblankSlotStateByKey = {}),
      (fillblankScoreSummary = null),
      clearPeekUiTimers(),
      syncPracticeActionButtons(),
      subtitleListEl.classList.remove(`oio-fillblank-reviewed`),
      (subtitleListEl.innerHTML = ``),
      mediaEl.pause(),
      stopPracticeSpeechPlayback(),
      mediaEl.removeAttribute(`src`),
      mediaEl.load(),
      syncPlayerTransportUi(),
      refreshPracticeUI());
  }),
  document.addEventListener(`app-tab-change`, (e) => {
    let t = e?.detail?.tabId;
    if (t === `daily-capture`) return;
    mediaEl.pause();
    stopPracticeSpeechPlayback();
    clearSpeechLoopTimer();
  }),
  refreshPracticeUI(),
  syncPlayerTransportUi());
(($t = new u({
  getCueListMode: () => cueListMode,
  getPlaybackCues: () => playbackCues,
  setCueListMode: (e) => {
    cueListMode = e;
  },
  syncSubtitlePracticeUI: syncSubtitlePracticeUI,
  updatePracticeModeButtons: updatePracticeModeButtons,
})));
((window.__practiceRuntimeReady = !0),
document.dispatchEvent(new CustomEvent(`practice-runtime-ready`)));

