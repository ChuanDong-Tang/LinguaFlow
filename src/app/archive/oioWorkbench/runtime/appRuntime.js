import { getDomRefs as p } from "./domRefs.js";
import { PlayerController as l } from "./PlayerController.js";
import { PracticeController as u } from "./PracticeController.js";
import { PEEK_MS as m } from "./constants.js";
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
  cloneBlankMap as sn,
  eventTargetElement as Gt,
} from "./runtimeUtils.js";
import { getAudioFacade } from "../../../services/audio/audioFacade";
import { createPracticeAudioFlow } from "../../../services/audio/practiceAudioFlow";
import { renderTextWithKeyPhraseHighlight} from "../../../shared/keyPhraseHighlight";
import { splitTextForSpeech } from "../../../services/audio/providers/webspeech/splitTextForSpeech";

var {
    textEl: Ue,
    voiceComboboxEl: We,
    voiceComboboxTrigger: Ge,
    voiceComboboxValue: Ke,
    voiceComboboxList: qe,
    btnEl: Je,
    clearInputBtn: Ye,
    statusEl: Xe,
    playerEl: v,
    subsSectionEl: Ze,
    subtitlesListEl: y,
    transportBarEl: Qe,
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
    practicePagePrevBtn: Ct2,
    practicePageNextBtn: wt2,
    practicePageIndicator: Tt2,
    practiceActionsBar: ct,
    fillblankCheckBtn: lt,
    dictationCheckBtn: Et2,
    proofreadSaveBtn: dt,
  } = p(),
  D = `subtitles`,
  O = {},
  k = {},
  A = null;
function Wt(e) {
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
        o = k[a];
      (o === `pending` || o === `wrong` || o === `ok`) &&
        n[r] == null &&
        (n[r] = o);
    }
  }
  k = n;
}
var I = -1,
  R = null,
  Jt = null,
  z = [],
  B = [],
  V = [],
  ue = [],
  pe = [],
  de = 0,
  H = -1,
  U = 0,
  lastPlayedCueIndex = -1,
  practicePageIndex = 0,
  speechActiveCueIndex = -1,
  Yt = new Map(),
  Xt = null,
  Qt = ``;
function W(e) {
  Xe && (Xe.textContent = e ?? ``);
}

var G = new l({
    playerEl: v,
    playerTimeDisplay: nt,
    playerSeekEl: rt,
    playerPlayBtn: et,
    playerPlayIcon: tt,
    playerRateEl: it,
    loopWholeCheckbox: $e,
    getPlaybackCues: () => z,
    getCueListMode: () => D,
    getCueInputs: () => V,
    getCueElements: () => B,
    getCueIndexForTime: Y,
    applyCuePosition: Zn,
    seekToCueNoPlay: Qn,
    firstFocusableFillBlankSlot: $n,
    formatClockSec: we,
  }),
  $t = null,
  practiceAudioFlow = createPracticeAudioFlow({
    getCueByIndex: (e) => z[e],
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
      practicePageIndex = ue[e] ?? e;
      Rr();
      H = e;
      for (let t = 0; t < B.length; t++) B[t].classList.toggle(`cue-row--active`, t === e);
    },
  });
function tn() {
  ((R &&= (URL.revokeObjectURL(R), null)), (Jt = null));
}
function on() {
  let e = {};
  for (let t = 0; t < z.length; t++) {
    let n = B[t]?.querySelector(`.cue-proofread`);
    if (!n) continue;
    let r = xe(z[t].text.trim()),
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
function cn(e) {
  for (let [t, n] of Object.entries(e)) {
    let e = Number(t);
    if (!Number.isFinite(e) || !B[e]) continue;
    let r = Array.isArray(n) ? n : [];
    for (let t of r)
      Se(xe(z[e].text.trim())[Number(t)] ?? ``) &&
      B[e]
        .querySelector(
          `.cue-proofread .pr-word[data-si="${e}"][data-wi="${t}"]`,
        )
        ?.classList.add(`pr-word--selected`);
  }
}
function ln(e, t) {
  let n = xe(z[e].text.trim()),
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
function un() {
  O = on();
}
function Ln(e, t) {
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
function Un() {
  let e = Ln(O, z);
  if (!e.length) {
    A = null;
    return;
  }
  let t = 0;
  for (let n of e) k[n] === `ok` && (t += 1);
  let n = Math.round((t / e.length) * 100);
  A = {
    totalBlanks: e.length,
    correctBlanks: t,
    percent: n,
    tier: Bt(n),
    updatedAt: new Date().toISOString(),
  };
}
function Wn() {
  D !== `fillblank` ||
    !z.length ||
    (y.querySelectorAll(`.fb-slot`).forEach((e) => {
      let t = e.dataset.fbSlotKey;
      t &&
        (e.classList.contains(`fb-slot--ok`)
          ? (k[t] = `ok`)
          : e.classList.contains(`fb-slot--wrong`)
            ? (k[t] = `wrong`)
            : (k[t] = `pending`));
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
function Y(e) {
  let t = 0;
  for (let n = 0; n < z.length; n++) e + 1e-4 >= z[n].start && (t = n);
  return t;
}
function Yn(e) {
  if (!z.length) return -1;
  for (let t = 0; t < z.length; t++) {
    let n = z[t],
      r = t === z.length - 1;
    if (e >= n.start && (r ? e <= n.end + 0.08 : e < n.end)) return t;
  }
  for (let t = z.length - 1; t >= 0; t--) {
    let n = z[t];
    if (e >= n.start && e <= n.end + 0.12) return t;
  }
  return Y(e);
}
function Xn(e) {
  B[e]?.scrollIntoView({ block: `center`, behavior: `smooth` });
}
function Zn(e) {
  z[e] &&
    ((v.currentTime = z[e].start),
    b?.checked && (U = e),
    (H = -1),
    syncActiveCueByCurrentTime(v.currentTime),
    Xn(e));
}
function Qn(e) {
  z[e] && (v.pause(), Zn(e));
}
function clearSpeechLoopTimer() {
  practiceAudioFlow.clearLoopTimer();
}
function stopPracticeSpeechPlayback({ invalidateLoop: e = !0 } = {}) {
  practiceAudioFlow.stop({ invalidateLoop: e });
}
function $n(e) {
  if (!e) return null;
  let t = e.querySelectorAll(`.fb-slot`);
  for (let e of t) if (!e.readOnly) return e;
  return t[0] ?? null;
}
function seekToNextCue() {
  if (!z.length) return;
  if (!v.src) {
    let e = wr();
    e >= 0 && e < z.length || (e = Math.max(0, Y(v.currentTime)));
    playCueInline(Math.min(z.length - 1, e + 1));
    return;
  }
  let e = Y(v.currentTime);
  Qn(Math.min(z.length - 1, e + 1));
}
function seekToPreviousCue() {
  if (!z.length) return;
  if (!v.src) {
    let e = wr();
    e >= 0 && e < z.length || (e = Math.max(0, Y(v.currentTime)));
    playCueInline(Math.max(0, e - 1));
    return;
  }
  let e = Y(v.currentTime);
  Qn(Math.max(0, e - 1));
}
function toggleMainPlayerPlayback() {
  if (!v.src) {
    if (!z.length) return;
    if (speechActiveCueIndex >= 0) {
      stopPracticeSpeechPlayback();
      return;
    }
    let e = wr();
    e >= 0 && e < z.length || (e = Math.max(0, Y(v.currentTime)));
    playCueInline(e);
    return;
  }
  if (v.paused) {
    v.play().catch(() => {});
    return;
  }
  v.pause();
}
function playCueInline(e) {
  v.pause();
  practiceAudioFlow.playCueInline(e);
}
function zr() {
  if (!de) {
    practicePageIndex = 0;
    return;
  }
  practicePageIndex = Math.max(0, Math.min(de - 1, practicePageIndex));
}
function Jr(e) {
  for (let t = 0; t < ue.length; t++) if ((ue[t] ?? 0) === e) return t;
  return -1;
}
function Rr() {
  zr();
  let e = de > 0;
  ut && (ut.hidden = !e);
  if (Tt2) Tt2.textContent = e ? `${practicePageIndex + 1} / ${de}` : `0 / 0`;
  Ct2 && (Ct2.disabled = !e || practicePageIndex <= 0);
  wt2 && (wt2.disabled = !e || practicePageIndex >= de - 1);
  for (let t = 0; t < B.length; t++)
    B[t].classList.toggle(`cue-row--paged-hidden`, (ue[t] ?? 0) !== practicePageIndex);
}
function qr(e, { focusDictation: t = !1 } = {}) {
  if (!de) return;
  practicePageIndex = e;
  Rr();
  let n = Jr(practicePageIndex);
  if (n < 0) return;
  let r = B[n];
  r?.scrollIntoView({ block: `nearest`, behavior: `smooth` });
  if (D === `dictation`) {
    (H = n),
      B.forEach((e, t) => e.classList.toggle(`cue-row--active`, t === n)),
      t && V[n]?.focus({ preventScroll: !0 });
  }
}
function syncPlayerTransportUi() {
  G.syncPlayerTransport();
  if (!et || !tt || v.src) return;
  let e = speechActiveCueIndex >= 0;
  tt.textContent = e ? `⏸` : `▶`;
  let t = et.querySelector(`.player-play-label`);
  t && (t.textContent = e ? `暂停` : `播放`);
  et.setAttribute(`aria-label`, e ? `暂停` : `播放`);
  et.setAttribute(`aria-pressed`, e ? `true` : `false`);
}
function resetPlayerTransportUi() {
  G.resetPlayerTransportOptions();
}
function Z() {
  (Yt.forEach((e) => clearTimeout(e)),
    Yt.clear(),
    (Xt &&= (clearTimeout(Xt), null)),
    B.forEach((e) => {
      (e.querySelector(`.cue-peek`)?.classList.remove(`cue-peek--visible`),
        e
          .querySelector(`.fb-peek-hint`)
          ?.classList.remove(`fb-peek-hint--visible`));
    }));
}
function ar(e) {
  if (!e?.classList?.contains(`fb-slot`)) return;
  let t = e.closest(`.cue-fillblank`);
  if (!t) return;
  let n = t.querySelector(`.fb-peek-hint`);
  (n ||
    ((n = document.createElement(`div`)),
    (n.className = `fb-peek-hint`),
    n.setAttribute(`aria-live`, `polite`),
    t.appendChild(n)),
    (n.textContent = e.dataset.answer ?? ``),
    n.classList.add(`fb-peek-hint--visible`),
    Xt && clearTimeout(Xt),
    (Xt = setTimeout(() => {
      (n.classList.remove(`fb-peek-hint--visible`), (Xt = null));
    }, m)));
}
function or() {
  let e = z.length > 0,
    t = D;
  if (!ct) return;
  let n = e && t === `proofread`,
    r = e && t === `fillblank`,
    i = e && t === `dictation`;
  (dt && (dt.hidden = !n),
    lt && (lt.hidden = !r),
    Et2 && (Et2.hidden = !i),
    (ct.hidden = !n && !r && !i));
}
async function cr(e) {
  W(e);
  return { outcome: `page-only` };
}
async function fr() {
  if (D !== `proofread` || !z.length) return;
  (un(),
    Wt(O),
    (A = null),
    await cr(`已确认创建。`),
    emitPracticeBlankIndexesUpdate(),
    br());
}
function emitPracticeBlankIndexesUpdate() {
  let e = Qt || Ue.dataset.practiceCaptureItemId || ``;
  if (!e) return;
  let t = Array.isArray(O?.[0]) ? O[0] : [],
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
function hr() {
  (y.classList.add(`oio-fillblank-reviewed`),
    y.querySelectorAll(`.fb-slot`).forEach((e) => {
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
function gr(e) {
  if (!z[e] || !B[e]) return;
  let t = B[e].querySelector(`.cue-peek`);
  if (!t) return;
  ((t.textContent = z[e].text), t.classList.add(`cue-peek--visible`));
  let n = Yt.get(e);
  (n && clearTimeout(n),
    Yt.set(
      e,
      setTimeout(() => {
        (t.classList.remove(`cue-peek--visible`), Yt.delete(e));
      }, m),
    ));
}
function _r() {
  for (let e = 0; e < z.length; e++) {
    let t = B[e]?.querySelector(`.cue-proofread`);
    if (!t) continue;
    t.replaceChildren();
    let r = document.createElement(`div`);
    ((r.className = `pr-ref-line`),
      xe(z[e].text.trim()).forEach((t, n) => {
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
function vr(e, t) {
  let n = B[e]?.querySelector(`.cue-fillblank`);
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
          (r.innerHTML = renderTextWithKeyPhraseHighlight(t.text, pe[e] ?? [])),
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
        let u = k[a];
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
            if (!y.classList.contains(`oio-fillblank-reviewed`)) return;
            (e.preventDefault(),
              e.stopPropagation(),
              (s.value = s.dataset.answer ?? ``),
              s.classList.remove(`fb-slot--wrong`),
              s.classList.add(`fb-slot--ok`),
              (s.readOnly = !1),
              delete s.dataset.fbRevealed,
              s.classList.remove(`fb-slot--revealed`),
              Wn(),
              Un());
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
function yr() {
  if (!z.length) return;
  (v.pause(), Z());
  let e = document.activeElement;
  (e?.classList?.contains(`cue-input`) && e.blur(),
    _r(),
    cn(O),
    un(),
    (D = `proofread`),
    Q(),
    Er());
}
function br() {
  if (z.length) {
    if (
      (Z(),
      y.classList.remove(`oio-fillblank-reviewed`),
      D === `proofread` && un(),
      !(Ln(O, z).length > 0))
    ) {
      W(`还没有可练习的填空。请先进入「创建填空」选择要挖空的词。`);
      return;
    }
    Wt(O);
    for (let e = 0; e < z.length; e++) vr(e, ln(e, O));
    ((D = `fillblank`),
      !v.paused && z.length && (I = Yn(v.currentTime)),
      Q(),
      Er());
  }
}
function xr() {
  (D === `proofread` && un(), (D = `subtitles`), Z(), Q(), Er());
}
function Sr() {
  (D === `proofread` && un(), (D = `dictation`), Q(), Er());
}
function Cr() {
  st &&
    st.querySelectorAll(`[data-set-practice-mode]`).forEach((e) => {
      let t = e.dataset.setPracticeMode;
      (e.classList.toggle(`practice-mode-btn--on`, t === D),
        (e.disabled = !z.length));
    });
}
function wr() {
  let e = document.activeElement;
  if (e?.classList?.contains(`cue-input`)) {
    let t = e.closest(`.cue-row`);
    if (t?.dataset.idx != null) return Number(t.dataset.idx);
  }
  if (e?.classList?.contains(`fb-slot`)) {
    let t = e.closest(`.cue-row`);
    if (t?.dataset.idx != null) return Number(t.dataset.idx);
  }
  return H >= 0 ? H : Y(v.currentTime);
}
function Tr() {
  let e = D !== `subtitles`;
  (B.forEach((t, n) => {
    let r = t.querySelector(`.cue-reference`),
      i = V[n],
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
      o?.classList.toggle(`cue-proofread--hidden`, D !== `proofread`),
      s?.classList.toggle(`cue-fillblank--hidden`, D !== `fillblank`));
    let l = D === `dictation`;
    (i.classList.toggle(`cue-input--visible`, l),
      c?.classList.remove(`cue-inline-play--hidden`));
  }),
    e || Z(),
    or(),
    D !== `fillblank` && (I = -1),
    st && ((st.hidden = !z.length), Er()),
    Rr());
}
function Er() {
  return Cr();
}
function Q() {
  return Tr();
}
function Dr() {
  return $t ? $t.goPracticeSubtitles() : xr();
}
function Or() {
  return $t ? $t.goPracticeDictation() : Sr();
}
function Ar(e, { cueCardIndexList: t = null, cardCount: n = null } = {}) {
  let r = Array.isArray(t) && t.length === e.length ? t : e.map((e, t) => t),
    i =
      Number.isFinite(n) && n > 0
        ? Math.max(1, Math.floor(n))
        : (r.length ? Math.max(...r) + 1 : 0);
  (!Array.isArray(pe) || pe.length !== e.length) && (pe = e.map(() => []));
  ((z = e),
    (ue = r),
    (de = i),
    (H = -1),
    (U = 0),
    (lastPlayedCueIndex = -1),
    (practicePageIndex = 0),
    Z(),
    (k = {}),
    (A = null),
    y.classList.remove(`oio-fillblank-reviewed`),
    (y.innerHTML = ``),
    (B = []),
    (V = []),
    e.forEach((e, t) => {
      let n = document.createElement(`div`);
      ((n.className = `cue-row`), (n.dataset.idx = String(t)));
      let i = document.createElement(`p`);
      ((i.className = `cue cue-reference`),
        (i.innerHTML = renderTextWithKeyPhraseHighlight(e.text, pe[t] ?? [])),
        i.addEventListener(`click`, (e) => {
          (e.stopPropagation(),
            (practicePageIndex = ue[t] ?? t),
            Rr(),
            (H = t),
            B.forEach((e, n) => e.classList.toggle(`cue-row--active`, n === t)),
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
          D !== `subtitles` &&
            (Gt(e)?.closest?.(`.fb-slot-actions`) ||
              ((practicePageIndex = ue[t] ?? t),
              Rr(),
              (H = t),
              B.forEach((e, n) => e.classList.toggle(`cue-row--active`, n === t)),
              (D === `proofread` || D === `fillblank`) && playCueInline(t)));
        }),
        y.appendChild(n),
        B.push(n),
        V.push(a));
    }),
    (D = `subtitles`),
    Q());
}
function syncActiveCueByCurrentTime(e) {
  if (!z.length || !B.length) return;
  let t = -1;
  if (D === `fillblank` && v.paused && I >= 0 && I < z.length) {
    let n = I,
      r = z[n];
    r && e + 1e-4 >= r.end - 0.1 && (t = n);
  }
  if (t < 0)
    for (let n = 0; n < z.length; n++) {
      let r = z[n],
        i = n === z.length - 1;
      if (e >= r.start && (i ? e <= r.end + 0.08 : e < r.end)) {
        t = n;
        break;
      }
    }
  if (t !== H) {
    for (let e = 0; e < B.length; e++)
      B[e].classList.toggle(`cue-row--active`, e === t);
    H = t;
  }
}
(v.addEventListener(`timeupdate`, () => {
  let e = v.currentTime,
    t = D === `fillblank`;
  if (t && !v.paused && z.length > 0 && I >= 0 && I < z.length) {
    let t = z[I];
    if (t && e >= t.end - 0.06) {
      v.pause();
      return;
    }
  }
  ((!v.paused || e > 0) && syncActiveCueByCurrentTime(e), syncPlayerTransportUi());
}),
  v.addEventListener(`play`, () => {
    if (D === `fillblank` && z.length) {
      let e = v.currentTime,
        t = I;
      if (t >= 0 && t < z.length) {
        let n = z[t];
        I = n && e + 1e-4 >= n.end - 0.12 ? t : Yn(e);
      } else I = Yn(e);
    }
    (syncActiveCueByCurrentTime(v.currentTime), syncPlayerTransportUi());
  }),
  v.addEventListener(`pause`, () => {
    (stopPracticeSpeechPlayback(), syncPlayerTransportUi());
  }),
  v.addEventListener(`loadedmetadata`, () => {
    syncPlayerTransportUi();
  }),
  v.addEventListener(`durationchange`, () => {
    syncPlayerTransportUi();
  }),
  v.addEventListener(`ended`, () => {
    (stopPracticeSpeechPlayback(), syncPlayerTransportUi());
  }),
  v.addEventListener(`seeked`, () => {
    (D === `fillblank` && z.length && (I = Yn(v.currentTime)),
      (H = -1),
      syncActiveCueByCurrentTime(v.currentTime),
      (v.paused || !z.length) && stopPracticeSpeechPlayback(),
      syncPlayerTransportUi());
  }),
  b?.addEventListener(`change`, () => {
    practiceAudioFlow.onCueLoopToggleChanged(!!b?.checked);
  }),
  $e?.addEventListener(`change`, () => {
    v.loop = !!$e.checked;
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
    Number.isFinite(e) && ((v.playbackRate = e), getAudioFacade().setPlaybackRate(e));
  }),
  Ct2?.addEventListener(`click`, () => {
    z.length && qr(practicePageIndex - 1, { focusDictation: D === `dictation` });
  }),
  wt2?.addEventListener(`click`, () => {
    z.length && qr(practicePageIndex + 1, { focusDictation: D === `dictation` });
  }),
  rt?.addEventListener(`pointerdown`, () => {
    G.setSeekDragging(!0);
  }),
  rt?.addEventListener(`pointerup`, () => {
    (G.setSeekDragging(!1), syncPlayerTransportUi());
  }),
  rt?.addEventListener(`pointercancel`, () => {
    G.setSeekDragging(!1);
  }),
  rt?.addEventListener(`input`, () => {
    let e = v.duration;
    !Number.isFinite(e) ||
      e <= 0 ||
      !rt ||
      (v.currentTime = (Number(rt.value) / 1e3) * e);
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
        ? Dr()
        : n === `dictation`
          ? Or()
          : n === `proofread`
            ? yr()
            : n === `fillblank` && br();
    }),
  y.addEventListener(`click`, (e) => {
    let t = Gt(e)?.closest?.(`.pr-word`);
    !t ||
      t.dataset.blankable !== `1` ||
      !y.contains(t) ||
      (e.stopPropagation(),
      t.classList.toggle(`pr-word--selected`),
      D === `proofread` &&
        ((practicePageIndex = ue[Number(t.dataset.si)] ?? Number(t.dataset.si)),
        Rr(),
        (H = Number(t.dataset.si)),
        B.forEach((e, n) => e.classList.toggle(`cue-row--active`, n === Number(t.dataset.si))),
        un(),
        playCueInline(Number(t.dataset.si))));
  }),
  lt?.addEventListener(`click`, () => {
    Mr().catch((e) => {
      (console.error(e), W(`记录填空正确率失败，请稍后再试。`));
    });
  }),
  Et2?.addEventListener(`click`, () => {
    Br();
  }));
async function Mr() {
  (hr(), Wn(), Un());
  let e = A;
  await cr(
    e
      ? `填空已校对（${e.correctBlanks}/${e.totalBlanks}，${e.percent}%）。`
      : `填空已校对。`,
  );
}
function Hr(e) {
  return xe(String(e || ``))
    .map((e) => Se(e))
    .filter(Boolean)
    .join(` `);
}
function Br() {
  if (D !== `dictation` || !z.length) return;
  let e = 0;
  for (let t = 0; t < z.length; t++) {
    let n = V[t];
    if (!n) continue;
    let r = Hr(z[t]?.text || ``),
      i = Hr(n.value || ``),
      a = !!i && i === r;
    (n.classList.toggle(`cue-input--ok`, a),
      n.classList.toggle(`cue-input--wrong`, !a),
      a && e++);
  }
  let t = Math.round((e / Math.max(1, z.length)) * 100);
  W(`听写已检查（${e}/${z.length}，${t}%）。`);
}
(dt?.addEventListener(`click`, () => {
    fr().catch((e) => {
      (console.error(e), W(`确认创建失败，请稍后再试。`));
    });
  }),
  y.addEventListener(`input`, (e) => {
    let t = e.target;
    (t?.classList?.contains(`fb-slot`) &&
      (t.readOnly || t.classList.remove(`fb-slot--wrong`, `fb-slot--ok`)),
      t?.classList?.contains(`cue-input`) &&
        t.classList.remove(`cue-input--ok`, `cue-input--wrong`));
  }),
  y.addEventListener(`focusin`, (e) => {
    let t = e.target;
    if (!z.length) return;
    if (t?.classList?.contains(`fb-slot`)) {
      if (D !== `fillblank`) return;
      let e = t.closest(`.cue-row`),
        n = e?.dataset.idx == null ? -1 : Number(e.dataset.idx);
      if (n < 0) return;
      (practicePageIndex = ue[n] ?? n), Rr();
      (H = n),
        B.forEach((e, t) => {
          e.classList.toggle(`cue-row--active`, t === n);
        }),
        playCueInline(n);
      return;
    }
    if (t?.classList?.contains(`cue-input`) && D === `dictation`) {
      let e = t.closest(`.cue-row`),
        n = e?.dataset.idx == null ? -1 : Number(e.dataset.idx);
      if (n < 0) return;
      (practicePageIndex = ue[n] ?? n), Rr();
      (H = n),
        B.forEach((e, t) => {
          e.classList.toggle(`cue-row--active`, t === n);
        }),
        playCueInline(n);
    }
  }),
  document.addEventListener(`keydown`, (e) => {
    if (e.repeat) return;
    let t = e.target?.classList?.contains(`cue-input`),
      n = e.target?.classList?.contains(`fb-slot`),
      r = D !== `subtitles`;
    if (n && e.code === `Tab` && D === `fillblank`) {
      if (!z.length) return;
      (e.preventDefault(), e.stopPropagation());
      let t = [...y.querySelectorAll(`.fb-slot`)].filter((e) => !e.readOnly),
        n = e.target,
        r = t.indexOf(n);
      if (r < 0) return;
      let i = e.shiftKey ? r - 1 : r + 1;
      if (i < 0 || i >= t.length) return;
      let a = t[i],
        o = Number(n.closest(`.cue-row`)?.dataset.idx),
        s = Number(a.closest(`.cue-row`)?.dataset.idx);
      (o !== s && Qn(s), a.focus({ preventScroll: !0 }));
      return;
    }
    if (r && e.ctrlKey && e.shiftKey && e.code === `ArrowDown`) {
      if (D === `dictation`) {
        let t = wr();
        t >= 0 && z[t] && (e.preventDefault(), e.stopPropagation(), gr(t));
      } else if (D === `fillblank`) {
        (e.preventDefault(), e.stopPropagation());
        let t = e.target?.classList?.contains(`fb-slot`) ? e.target : null;
        if (!t) {
          let e = wr();
          e >= 0 && (t = $n(B[e]) ?? B[e]?.querySelector(`.fb-slot`));
        }
        t && ar(t);
      }
      return;
    }
    if ((t || n) && e.ctrlKey) {
      if (e.code === `ArrowUp`) {
        if (!e.shiftKey) return;
        (e.preventDefault(), e.stopPropagation(), toggleMainPlayerPlayback());
        return;
      }
      if (e.code === `ArrowLeft`) {
        if (!z.length) return;
        (e.preventDefault(), e.stopPropagation(), seekToPreviousCue());
        return;
      }
      if (e.code === `ArrowRight`) {
        if (!z.length) return;
        (e.preventDefault(), e.stopPropagation(), seekToNextCue());
        return;
      }
    }
    let i = je(e.target, Ue),
      a = e.ctrlKey || e.altKey;
    if (e.code === `Space`) {
      if (Me(e.target) || t || n || (i && !a) || !z.length) return;
      (e.preventDefault(), toggleMainPlayerPlayback());
      return;
    }
    if (e.code === `ArrowRight` || e.code === `ArrowLeft`) {
      if (t || n || (i && !a) || Ne(e.target) || !z.length) return;
      (e.preventDefault(), e.code === `ArrowRight` ? seekToNextCue() : seekToPreviousCue());
    }
  }),
  Je.addEventListener(`click`, async () => {
    let e = Ue.value.trim();
    if (!e) {
      W(`请先粘贴或输入英文文本。`);
      return;
    }
    let n2 = Ue.dataset.practiceOpeningHint === `daily`;
    Qt = n2 ? String(Ue.dataset.practiceCaptureItemId || ``).trim() : ``;
    W(`正在生成练习...`);
    let t = [],
      n = [],
      r2 = [],
      i2 = [];
    try {
      n = JSON.parse(Ue.dataset.practiceCardChunks || `[]`);
    } catch {
      n = [];
    }
    try {
      r2 = JSON.parse(Ue.dataset.practiceCardKeyPhrases || `[]`);
    } catch {
      r2 = [];
    }
    try {
      i2 = JSON.parse(Ue.dataset.practiceBlankIndexes || `[]`);
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
    pe = i.map((e, t) => {
      let n = a[t] ?? 0,
        r = Array.isArray(r2?.[n]) ? r2[n] : [];
      return r
        .map((e) => String(e ?? ``).trim())
        .filter(Boolean);
    });
    t = i;
    Je.disabled = !0;
    try {
      ((z = []),
        (ue = []),
        (de = 0),
        (B = []),
        (V = []),
        (H = -1),
        (U = 0),
        b && (b.checked = !1),
        resetPlayerTransportUi(),
        (D = `subtitles`),
        (O = {}),
        (k = {}),
        Z(),
        or(),
        y.classList.remove(`oio-fillblank-reviewed`),
        (y.innerHTML = ``),
        v.pause(),
        stopPracticeSpeechPlayback(),
        tn(),
        v.removeAttribute(`src`),
        v.load());
      if (Array.isArray(i2) && i2.length > 0) {
        let e = Array.from(
          new Set(
            i2
              .map((e) => Number(e))
              .filter((e) => Number.isFinite(e) && e >= 0)
              .map((e) => Math.floor(e)),
          ),
        ).sort((e, t) => e - t);
        e.length && (O = { 0: e });
      }
      let o = buildEstimatedCues(t);
      ((Jt = null),
        (R = null),
        Ar(o, { cueCardIndexList: a, cardCount: Math.max(1, r.length) }),
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
        (W(`正在预加载语音（${d.length} 句）...`), (h = [c]));
        let e = await l.prefetchTexts(d);
        if (!e && c === `kokoro`) {
          (W(`Kokoro 预加载失败，正在切换到 Web Speech...`),
            (await l.switchProvider(`web`)) && ((c = l.getActiveProviderId()), h.push(c), (e = await l.prefetchTexts(d))));
        }
      }
      let g = l.getActiveProviderId() === `kokoro` ? `Kokoro` : `Web Speech`,
        m = h.length > 1 ? `（本次已自动回退到 Web Speech）` : ``;
      W(`完成。共 ${r.length} 张卡片，${t.length} 句。当前语音源：${g}${m}。`);
    } catch (e) {
      (console.error(e),
        W(
          e?.message
            ? `出错：${e.message}`
            : `生成失败，请打开控制台查看详情。`,
        ));
    } finally {
      delete Ue.dataset.practiceCardChunks;
      delete Ue.dataset.practiceCardKeyPhrases;
      delete Ue.dataset.practiceCaptureItemId;
      delete Ue.dataset.practiceBlankIndexes;
      delete Ue.dataset.practiceOpeningHint;
      Je.disabled = !1;
    }
  }),
  Ye?.addEventListener(`click`, () => {
    ((Ue.value = ``),
      (Qt = ``),
      delete Ue.dataset.practiceCardChunks,
      delete Ue.dataset.practiceCardKeyPhrases,
      delete Ue.dataset.practiceCaptureItemId,
      delete Ue.dataset.practiceBlankIndexes,
      delete Ue.dataset.practiceOpeningHint,
      W(``),
      (z = []),
      (ue = []),
      (pe = []),
      (de = 0),
      (B = []),
      (V = []),
      (H = -1),
      (U = 0),
      b && (b.checked = !1),
      resetPlayerTransportUi(),
      (D = `subtitles`),
      (O = {}),
      (k = {}),
      (A = null),
      Z(),
      or(),
      y.classList.remove(`oio-fillblank-reviewed`),
      (y.innerHTML = ``),
      v.pause(),
      stopPracticeSpeechPlayback(),
      tn(),
      (Jt = null),
      v.removeAttribute(`src`),
      v.load(),
      syncPlayerTransportUi(),
      Q());
  }),
  document.addEventListener(`app-tab-change`, (e) => {
    let t = e?.detail?.tabId;
    if (t === `daily-capture`) return;
    v.pause();
    stopPracticeSpeechPlayback();
    clearSpeechLoopTimer();
  }),
  Q(),
  syncPlayerTransportUi());
(($t = new u({
  getCueListMode: () => D,
  getPlaybackCues: () => z,
  setCueListMode: (e) => {
    D = e;
  },
  syncSubtitlePracticeUI: Tr,
  updatePracticeModeButtons: Cr,
})));
((window.__practiceRuntimeReady = !0),
document.dispatchEvent(new CustomEvent(`practice-runtime-ready`)));
