import { getDomRefs as p } from "./domRefs.js";
import { PlayerController as l } from "./PlayerController.js";
import { PracticeController as u } from "./PracticeController.js";
import { HistoryController as d } from "./HistoryController.js";
import { HistoryExportController as _e } from "./HistoryExportController.js";
import { ImportExportController as f } from "./ImportExportController.js";
import { PEEK_MS as m, EXPORT_SCHEMA_VERSION as h, HISTORY_COLLAPSE_KEY as ee } from "./constants.js";
import { saveSession as Re, listSessions as Be, getSession as Ve, deleteSession as He } from "../../../../historyIdb.js";
import { toLocalDateKeyFromSaved as ie, savedAtIsoForImportedBasename as oe } from "../../../dateUtils.js";
import {
  splitSentences as ge,
  tokenizeWords as xe,
  normFillToken as Se,
  normFillAnswer as Ce,
  formatClockSec as we,
} from "./textUtils.js";
import {
  isImportJsonFile as Te,
  isImportAudioFile as Ee,
  importFileStem as De,
  buildImportPairs as Oe,
  validateImportPayload as ke,
  importOrphanNote as Ae,
  isTypingField as je,
  isSpaceReservedControl as Me,
  isArrowReservedControl as Ne,
  nextExportBasename as nn,
  downloadBlob as rn,
  audioBlobToExtension as an,
  cloneBlankMap as sn,
  makeHistoryPreview as dn,
  rowMatchesHistoryExportFilter as hn,
  fillBlankAccuracyTierFromPercent as Bt,
  fillBlankTierLabelZh as Vt,
  fingerprintBlankMap as Ht,
  validFillBlankStateKeySetFromMap as Ut,
  eventTargetElement as Gt,
} from "./runtimeUtils.js";
import {
  getBrowserTtsService as qn,
  getSelectedTtsPlaybackSource as Jn,
} from "../../../services/tts/browserTtsService";

const LOCAL_HISTORY_ENABLED = false;

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
    historyExportBtn: ft,
    historyExportDialog: pt,
    historyExportFrom: mt,
    historyExportTo: ht,
    historyExportApplyRange: gt,
    historyExportClearRange: _t,
    historyExportSelectAll: x,
    historyExportCount: vt,
    historyExportList: S,
    historyExportCancel: yt,
    historyExportConfirm: bt,
    oioImportSuccessDialog: xt,
    oioImportSuccessBody: St,
    oioImportSuccessOk: Ct,
    oioImportReportDialog: wt,
    oioImportReportTitle: Tt,
    oioImportReportBody: Et,
    oioImportReportOk: Dt,
    fillblankUpdateDoneDialog: Ot,
    fillblankUpdateDoneBody: kt,
    fillblankUpdateDoneOk: At,
    historySectionEl: jt,
    historyCollapseBtn: Mt,
    historyCollapsibleEl: Nt,
    historyContextLabelEl: C,
    historyGranularityEl: w,
    historyNavRootEl: T,
    historyEntriesRootEl: E,
    historyMagicCardEl: Pt,
    historyQuickJumpBtn: Ft,
    historyJumpDialog: It,
    historyJumpText: Lt,
    historyJumpCancel: Rt,
    historyJumpConfirm: zt,
  } = p(),
  D = `subtitles`,
  O = {},
  k = {},
  A = null;
function Wt(e) {
  let t = Ut(e),
    n = {};
  for (let [e, r] of Object.entries(k))
    (r !== `pending` && r !== `wrong` && r !== `ok`) ||
      (t.has(e) && (n[e] = r));
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
var qt = `month`,
  j = null,
  M = 0,
  N = 0,
  P = ``,
  F = null,
  I = -1,
  L = ``,
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
  te = -1,
  lastPlayedCueIndex = -1,
  practicePageIndex = 0,
  speechLoopToken = 0,
  speechLoopTimer = null,
  practiceGenerateRunCount = 0,
  Yt = new Map(),
  Xt = null;
function W(e) {
  Xe && (Xe.textContent = e ?? ``);
}
function dn2(e) {
  return String(e ?? ``).replace(/[&<>"']/g, (e) =>
    e === `&`
      ? `&amp;`
      : e === `<`
      ? `&lt;`
      : e === `>`
      ? `&gt;`
      : e === `"`
      ? `&quot;`
      : `&#39;`,
  );
}
function hn2(e) {
  return String(e ?? ``).replace(/[.*+?^${}()|[\]\\]/g, `\\$&`);
}
function pn2(e, t) {
  let n = String(e ?? ``),
    r = Array.isArray(t)
      ? t
          .map((e) => String(e ?? ``).trim())
          .filter(Boolean)
          .sort((e, t) => t.length - e.length)
      : [];
  if (!n || !r.length) return dn2(n);
  let i = [],
    a = new Set();
  for (let e of r) {
    let t = e.toLowerCase();
    if (a.has(t)) continue;
    a.add(t);
    let r = new RegExp(hn2(e), `gi`),
      o = null;
    for (; (o = r.exec(n)) !== null; ) {
      if (!o[0]) break;
      i.push({ start: o.index, end: o.index + o[0].length });
    }
  }
  if (!i.length) return dn2(n);
  i.sort((e, t) => (e.start !== t.start ? e.start - t.start : t.end - e.end));
  let o = [],
    s = 0;
  for (let e of i) (!o.length || e.start >= s) && (o.push(e), (s = e.end));
  let c = ``,
    l = 0;
  for (let e of o)
    (e.start > l && (c += dn2(n.slice(l, e.start))),
      (c += `<mark class="cue-keyphrase-highlight">${dn2(n.slice(e.start, e.end))}</mark>`),
      (l = e.end));
  return l < n.length && (c += dn2(n.slice(l))), c;
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
  K = {
    initDateState: () => {},
    syncJumpInput: () => {},
    syncJumpConfirmState: () => {},
    groupByLocalDate: () => new Map(),
    getDayRows: () => [],
    renderEntries: () => {},
    renderToday: () => {},
    renderWeek: () => {},
    renderMonth: () => {},
    renderAllNav: () => {},
    openJumpDialog: () => {},
    renderHistoryList: async () => {},
    alignHistoryStateToGranularity: () => {},
    ensureWeekSelectionInRange: () => {},
    ensureMonthSelectionInMonth: () => {},
    setGranularity: () => {},
    shiftWeek: () => {},
    shiftMonth: () => {},
    selectDay: () => {},
    setCalendarYear: () => {},
    setCalendarMonth: () => {},
    setCurrentHistoryEntryId: () => {},
    getCurrentHistoryEntryId: () => null,
    clearCurrentHistoryEntryId: () => {},
    markSessionSaved: () => {},
    handleJumpTextBlur: () => {},
    applyJumpFromText: () => !1,
  },
  exportCtrl = {
    wireEvents: () => {},
    openDialog: async () => {},
    renderFilteredList: () => {},
    syncSelectAllState: () => {},
    buildZip: async () => null,
    downloadSingle: async () => {},
  },
  en = {
    wirePracticePackImport: () => {},
    processImportedFiles: async () => {},
  };
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
async function fn() {
  if (!LOCAL_HISTORY_ENABLED) return null;
  if (!z.length) return null;
  let e = Jt;
  if (!e && R)
    try {
      e = await (await fetch(R)).blob();
    } catch {
      return null;
    }
  if (!e) return null;
  let t = nn(),
    n = Pn(),
    r = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      basename: t,
      payload: n,
      audioBlob: e,
    };
  try {
    return (await Re(r), K.markSessionSaved(r.savedAt, r.id), await J({ scrollToId: !1 }), t);
  } catch (e) {
    return (console.error(e), null);
  }
}

async function yn(e, t, n) {
  if (!LOCAL_HISTORY_ENABLED) return { ok: !1, error: `当前版本已关闭本地历史。` };
  let r = ke(e);
  if (r) return { ok: !1, error: r };
  if (!(t instanceof Blob)) return { ok: !1, error: `音频文件无效。` };
  let i = String(n ?? ``)
    .trim()
    .replace(/[/\\?*:|"<>]/g, `-`)
    .slice(0, 120);
  i ||= nn();
  let a = {
    id: crypto.randomUUID(),
    savedAt: oe(i),
    basename: i,
    payload: e,
    audioBlob: t,
  };
  try {
    return (await Re(a), { ok: !0, id: a.id });
  } catch (e) {
    return (console.error(e), { ok: !1, error: `写入本地历史失败。` });
  }
}
function wn(e, t, n = F) {
  let r = document.createElement(`div`);
  ((r.className = `history-entry-row`),
    (r.dataset.historyEntryId = e.id),
    e.id === n && r.classList.add(`history-entry-row--current`));
  let i = document.createElement(`div`);
  i.className = `history-entry-main`;
  let a = document.createElement(`p`);
  ((a.className = `history-entry-label`), (a.textContent = t));
  let o = document.createElement(`p`);
  ((o.className = `history-entry-meta`),
    (o.textContent =
      [e.basename || e.label || ``, dn(e.payload?.sourceText)]
        .filter(Boolean)
        .join(` · `) || ` `),
    i.appendChild(a),
    i.appendChild(o));
  let s = document.createElement(`div`);
  s.className = `history-entry-actions`;
  let c = Gn(zn(e.payload));
  c && s.appendChild(c);
  let l = document.createElement(`button`);
  ((l.type = `button`),
    (l.className = `history-act-load`),
    (l.textContent = `载入`),
    (l.dataset.historyLoad = e.id));
  let d = document.createElement(`button`);
  return (
    (d.type = `button`),
    (d.className = `history-act-del`),
    (d.textContent = `删除`),
    (d.dataset.historyDelete = e.id),
    s.appendChild(l),
    s.appendChild(d),
    r.appendChild(i),
    r.appendChild(s),
    r
  );
}
async function J(e = {}) {
  return K.renderHistoryList(e);
}

function Pn() {
  let e = z.length,
    t = [];
  for (let n = 0; n < e; n++) t.push(V[n]?.value ?? ``);
  let n = {
    schemaVersion: h,
    appId: `kokoro-tts-web`,
    exportedAt: new Date().toISOString(),
    sourceText: Ue.value,
    cues: z.map((e) => ({ start: e.start, end: e.end, text: e.text })),
    dictation: t,
    proofreadBlanks: D === `proofread` ? on() : sn(O),
    fillBlankSlotStates: { ...k },
  };
  return (A && A.totalBlanks > 0 && (n.fillBlankAccuracy = { ...A }), n);
}
function Fn(e) {
  if (!e || typeof e != `object`) return null;
  let t = Number(e.totalBlanks),
    n = Number(e.correctBlanks);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(n) || n < 0)
    return null;
  let r = Math.min(n, t),
    i = Number(e.percent);
  (Number.isFinite(i) || (i = Math.round((r / t) * 100)),
    (i = Math.max(0, Math.min(100, Math.round(i)))));
  let a =
      typeof e.updatedAt == `string` && e.updatedAt
        ? e.updatedAt
        : new Date().toISOString(),
    o = Bt(i);
  return {
    totalBlanks: t,
    correctBlanks: r,
    percent: i,
    tier: o,
    updatedAt: a,
  };
}
function In(e) {
  return !e || typeof e != `object`
    ? !1
    : Object.values(e).some((e) => e === `ok` || e === `wrong`);
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
function Rn(e, t, n, r) {
  let i = t && typeof t == `object` ? t : {},
    a = Ln(e, n);
  if (!a.length) return null;
  let o = 0;
  for (let e of a) i[e] === `ok` && (o += 1);
  let s = a.length,
    c = typeof r == `string` && r ? r : new Date().toISOString(),
    l = Math.round((o / s) * 100);
  return {
    totalBlanks: s,
    correctBlanks: o,
    percent: l,
    tier: Bt(l),
    updatedAt: c,
  };
}
function zn(e) {
  return e
    ? Fn(e.fillBlankAccuracy) ||
        (In(e.fillBlankSlotStates)
          ? Rn(
              e.proofreadBlanks,
              e.fillBlankSlotStates,
              e.cues,
              typeof e.exportedAt == `string` ? e.exportedAt : ``,
            )
          : null)
    : null;
}
function Bn(e) {
  if (!Array.isArray(e) || e.length === 0) return null;
  let t = 0,
    n = 0;
  for (let r of e) {
    let e = zn(r.payload);
    e && ((t += e.percent), (n += 1));
  }
  return n === 0 ? null : { percent: Math.round(t / n), count: n };
}
function Vn(e, t, n = {}) {
  if (!Number.isFinite(e) || t < 1) return null;
  let r = n.size ?? 28,
    i = r <= 26 ? 2.25 : 2.75,
    a = Math.max(0, Math.min(100, Math.round(e))),
    o = (r - i) / 2 - 0.5,
    s = r / 2,
    c = r / 2,
    l = 2 * Math.PI * o,
    u = (a / 100) * l,
    d = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`);
  (d.setAttribute(`class`, `history-cal-fb-ring-svg`),
    d.setAttribute(`viewBox`, `0 0 ${r} ${r}`),
    d.setAttribute(`width`, String(r)),
    d.setAttribute(`height`, String(r)));
  let f = document.createElementNS(`http://www.w3.org/2000/svg`, `circle`);
  (f.setAttribute(`cx`, String(s)),
    f.setAttribute(`cy`, String(c)),
    f.setAttribute(`r`, String(o)),
    f.setAttribute(`fill`, `none`),
    f.setAttribute(`stroke-width`, String(i)),
    f.setAttribute(`class`, `history-fb-ring-track`));
  let p = document.createElementNS(`http://www.w3.org/2000/svg`, `circle`);
  (p.setAttribute(`cx`, String(s)),
    p.setAttribute(`cy`, String(c)),
    p.setAttribute(`r`, String(o)),
    p.setAttribute(`fill`, `none`),
    p.setAttribute(`stroke-width`, String(i)),
    p.setAttribute(`stroke-linecap`, `round`));
  let m = Bt(a);
  (p.setAttribute(
    `class`,
    `history-fb-ring-progress history-fb-ring-tier--${m}`,
  ),
    p.setAttribute(`stroke-dasharray`, `${u} ${l}`),
    p.setAttribute(`transform`, `rotate(-90 ${s} ${c})`),
    d.appendChild(f),
    d.appendChild(p));
  let h = document.createElement(`div`);
  ((h.className = n.wrapClass || `history-cal-fb-ring-wrap`),
    h.setAttribute(`role`, `img`));
  let ee =
      t > 1
        ? `当日 ${t} 条含填空统计的练习平均正确率 ${a}%`
        : `填空正确率 ${a}%`,
    te = Vt(m);
  return (
    h.setAttribute(`aria-label`, `${ee}，等级 ${te}`),
    (h.title =
      t > 1
        ? `当日 ${t} 条平均 ${a}%（${te}）；逐条百分比算术平均`
        : `填空正确率 ${a}%（${te}）`),
    h.appendChild(d),
    h
  );
}
function Hn(e, t) {
  let n = Bn(t);
  if (!n) return;
  let r = Vn(n.percent, n.count, { size: 26 });
  if (!r) return;
  let i = document.createElement(`div`);
  ((i.className = `history-cal-fb-ring-anchor`),
    i.appendChild(r),
    e.appendChild(i));
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
    }),
    Ht(O));
}
function Gn(e) {
  if (!e || e.totalBlanks <= 0) return null;
  let t = 2 * Math.PI * 15.5,
    n = t * (e.percent / 100),
    r = Bt(e.percent),
    i = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`);
  (i.setAttribute(`class`, `history-fb-ring-svg`),
    i.setAttribute(`viewBox`, `0 0 36 36`),
    i.setAttribute(`width`, `36`),
    i.setAttribute(`height`, `36`));
  let a = document.createElementNS(`http://www.w3.org/2000/svg`, `circle`);
  (a.setAttribute(`cx`, `18`),
    a.setAttribute(`cy`, `18`),
    a.setAttribute(`r`, `15.5`),
    a.setAttribute(`fill`, `none`),
    a.setAttribute(`stroke-width`, `3`),
    a.setAttribute(`class`, `history-fb-ring-track`));
  let o = document.createElementNS(`http://www.w3.org/2000/svg`, `circle`);
  (o.setAttribute(`cx`, `18`),
    o.setAttribute(`cy`, `18`),
    o.setAttribute(`r`, `15.5`),
    o.setAttribute(`fill`, `none`),
    o.setAttribute(`stroke-width`, `3`),
    o.setAttribute(`stroke-linecap`, `round`),
    o.setAttribute(
      `class`,
      `history-fb-ring-progress history-fb-ring-tier--${r}`,
    ),
    o.setAttribute(`stroke-dasharray`, `${n} ${t}`),
    o.setAttribute(`transform`, `rotate(-90 18 18)`));
  let s = document.createElementNS(`http://www.w3.org/2000/svg`, `text`);
  (s.setAttribute(`x`, `18`),
    s.setAttribute(`y`, `18`),
    s.setAttribute(`text-anchor`, `middle`),
    s.setAttribute(`dominant-baseline`, `central`),
    s.setAttribute(`class`, `history-fb-ring-text`),
    (s.textContent = `${e.percent}%`),
    i.appendChild(a),
    i.appendChild(o),
    i.appendChild(s));
  let c = Vt(r),
    l = document.createElement(`div`);
  return (
    (l.className = `history-fb-ring-wrap`),
    l.setAttribute(`role`, `img`),
    l.setAttribute(
      `aria-label`,
      `填空正确率 ${e.percent}%，${e.correctBlanks} / ${e.totalBlanks} 空正确，等级 ${c}`,
    ),
    (l.title = `填空 ${e.correctBlanks} / ${e.totalBlanks} 正确（${e.percent}%，${c}）`),
    l.appendChild(i),
    l
  );
}
function Kn(e, t, { historySessionId: n = null } = {}) {
  let r = ke(e);
  if (r) return (W(r), !1);
  (Z(), v.pause(), tn());
  let i = e.cues.map((e) => ({
    start: Number(e.start),
    end: Number(e.end),
    text: String(e.text ?? ``),
  }));
  ((Ue.value = e.sourceText == null ? `` : String(e.sourceText)),
    (Jt = t),
    (R = URL.createObjectURL(t)),
    (v.src = R),
    v.load(),
    b && (b.checked = !1),
    ir(),
    (U = 0),
    (H = -1),
    Ar(i));
  let a = Array.isArray(e.dictation) ? e.dictation : [];
  for (let e = 0; e < V.length; e++)
    V[e].value = a[e] == null ? `` : String(a[e]);
  O = sn(
    e.proofreadBlanks && typeof e.proofreadBlanks == `object`
      ? e.proofreadBlanks
      : {},
  );
  let o =
    e.fillBlankSlotStates && typeof e.fillBlankSlotStates == `object`
      ? e.fillBlankSlotStates
      : {};
  k = {};
  for (let [e, t] of Object.entries(o))
    (t === `pending` || t === `wrong` || t === `ok`) && (k[e] = t);
  return (
    Wt(O),
    Ht(O),
    (D = `subtitles`),
    (A =
      Fn(e.fillBlankAccuracy) ??
      (In(e.fillBlankSlotStates)
        ? Rn(e.proofreadBlanks, e.fillBlankSlotStates, i, e.exportedAt)
        : null)),
    Q(),
    jr(v.currentTime),
    X(),
    K.setCurrentHistoryEntryId(n),
    W(`已导入练习包（${e.schemaVersion || `1.0.0`}，共 ${i.length} 句）`),
    K.renderHistoryList().catch(() => {}),
    !0
  );
}
function isMobileGenerationClient() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ``);
}
function yieldToMainThread() {
  return new Promise((e) => setTimeout(e, 0));
}
function splitTtsSentenceChunks(e, t) {
  let n = String(e || ``).trim();
  if (!n) return [];
  if (n.length <= t) return [n];
  let r = n
      .split(/(?<=[,;:，；：])\s+|\s+-\s+|\s+/)
      .map((e) => e.trim())
      .filter(Boolean),
    i = [],
    a = ``;
  for (let o of r) {
    let s = a ? `${a} ${o}` : o;
    if (s.length <= t) {
      a = s;
      continue;
    }
    a && (i.push(a), (a = ``));
    if (o.length <= t) {
      a = o;
      continue;
    }
    for (let c = 0; c < o.length; c += t) {
      let l = o.slice(c, c + t).trim();
      l && i.push(l);
    }
  }
  return a && i.push(a), i.length ? i : [n];
}
function buildTtsChunkPlan(e, t) {
  return e.map((e) => ({ text: e, chunks: splitTtsSentenceChunks(e, t) }));
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
function splitPracticeSentences(e) {
  let t = ge(e);
  if (Array.isArray(t) && t.length > 1) return t;
  let n = String(e || ``)
    .split(/\r?\n+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (!n.length) return [];
  let r = [];
  for (let e of n) {
    let t = e
      .split(/(?<=[.!?…])\s+|(?<=[;；])\s+/g)
      .map((e) => e.trim())
      .filter(Boolean);
    r.push(...(t.length ? t : [e]));
  }
  return r.length ? r : n;
}
function buildSilentWavBlob(e, t = 8e3) {
  let n = Math.max(1, Math.ceil(Math.max(0.5, e) * t)),
    r = new ArrayBuffer(44 + n),
    i = new DataView(r),
    a = 0;
  function o(e) {
    for (let t = 0; t < e.length; t++) i.setUint8(a++, e.charCodeAt(t));
  }
  return (
    o(`RIFF`),
    i.setUint32(a, 36 + n, !0),
    (a += 4),
    o(`WAVE`),
    o(`fmt `),
    i.setUint32(a, 16, !0),
    (a += 4),
    i.setUint16(a, 1, !0),
    (a += 2),
    i.setUint16(a, 1, !0),
    (a += 2),
    i.setUint32(a, t, !0),
    (a += 4),
    i.setUint32(a, t, !0),
    (a += 4),
    i.setUint16(a, 1, !0),
    (a += 2),
    i.setUint16(a, 8, !0),
    (a += 2),
    o(`data`),
    i.setUint32(a, n, !0),
    (a += 4),
    new Blob([r], { type: `audio/wav` })
  );
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
    jr(v.currentTime),
    Xn(e));
}
function Qn(e) {
  z[e] && (v.pause(), Zn(e));
}
function clearSpeechLoopTimer() {
  speechLoopTimer && (clearTimeout(speechLoopTimer), (speechLoopTimer = null));
}
function stopSpeechPlayback({ invalidateLoop: e = !0 } = {}) {
  e && (speechLoopToken += 1);
  clearSpeechLoopTimer();
  qn().stop();
  te = -1;
}
function scheduleCueLoop(e, t) {
  clearSpeechLoopTimer();
  speechLoopTimer = setTimeout(() => {
    if (!b?.checked || lastPlayedCueIndex < 0) return;
    if (e !== speechLoopToken || lastPlayedCueIndex !== t) return;
    speakCue(t, { fromLoop: !0, loopToken: e });
  }, 120);
}
function speakCue(e, { fromLoop: t = !1, loopToken: n = null } = {}) {
  if (!z[e]) return;
  let r = parseFloat(it?.value || `1`);
  qn().setPlaybackRate(Number.isFinite(r) ? r : 1);
  t || (speechLoopToken += 1);
  let i = n ?? speechLoopToken,
    a = z[e].text || ``;
  clearSpeechLoopTimer();
  stopSpeechPlayback({ invalidateLoop: !1 });
  te = e;
  qn()
    .speak(a)
    .then((t) => {
      t &&
        b?.checked &&
        lastPlayedCueIndex >= 0 &&
        i === speechLoopToken &&
        lastPlayedCueIndex === e &&
        scheduleCueLoop(i, e);
    })
    .finally(() => {
      te === e && (te = -1);
    });
}
function $n(e) {
  if (!e) return null;
  let t = e.querySelectorAll(`.fb-slot`);
  for (let e of t) if (!e.readOnly) return e;
  return t[0] ?? null;
}
function er(e) {
  Qn(e);
}
function tr() {
  if (!z.length || !v.src) return;
  let e = Y(v.currentTime);
  Qn(Math.min(z.length - 1, e + 1));
}
function nr() {
  if (!z.length || !v.src) return;
  let e = Y(v.currentTime);
  Qn(Math.max(0, e - 1));
}
function rr() {
  if (!v.src) return;
  if (v.paused) {
    v.play().catch(() => {});
    return;
  }
  v.pause();
}
function playCueInline(e) {
  if (!z[e]) return;
  lastPlayedCueIndex = e;
  practicePageIndex = ue[e] ?? e;
  Rr();
  H = e;
  for (let t = 0; t < B.length; t++) B[t].classList.toggle(`cue-row--active`, t === e);
  speakCue(e);
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
function X() {
  G.syncPlayerTransport();
}
function ir() {
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
async function sr() {
  if (!LOCAL_HISTORY_ENABLED) return { ok: !1, reason: `disabled` };
  if (!z.length) return { ok: !1, reason: `no-cues` };
  let e = K.getCurrentHistoryEntryId();
  if (!e) return { ok: !1, reason: `no-active-id` };
  let t = await Ve(e);
  return !t?.payload || !t.audioBlob
    ? { ok: !1, reason: `bad-row` }
    : ((t.payload = Pn()),
      (t.savedAt = new Date().toISOString()),
      await Re(t),
      await J({ scrollToId: !1 }),
      { ok: !0, reason: `updated` });
}
async function cr(e) {
  if (!LOCAL_HISTORY_ENABLED) return (W(e), { outcome: `page-only` });
  let t = ``,
    n = `error`;
  try {
    let e = await sr();
    if (e.ok)
      ((n = `history`),
        (t = `已同步到本地历史（与下载 JSON 内容一致），刷新后从同一条历史载入即可恢复。`));
    else if (e.reason === `no-active-id`) {
      let e = await fn();
      e
        ? ((n = `new-history`),
          (t = `已新建本地历史「${e}」并写入；之后继续练习并点「检查填空」即可更新同一条。`))
        : ((n = `page-only`),
          (t = `无法写入本地历史（可能无缓存音频）；当前内容仅保留在本页。`));
    } else
      ((n = `page-only`),
        (t = `本地历史条目不完整，未能写入；当前内容仅保留在本页。`));
  } catch (e) {
    (console.error(e), (n = `error`), (t = `写入本地历史失败，请稍后再试。`));
  }
  return (W(`${e}${t}`), { outcome: n });
}
async function fr() {
  if (D !== `proofread` || !z.length) return;
  (un(), Wt(O), Ht(O), (A = null), await cr(`已确认创建。`), br());
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
          (r.innerHTML = pn2(t.text, pe[e] ?? [])),
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
          s.setAttribute(`aria-label`, `第 ${e + 1} 句填空`));
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
    (Wt(O), Ht(O));
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
        c?.classList.remove(`cue-inline-play--hidden`),
        o?.classList.add(`cue-proofread--hidden`),
        s?.classList.add(`cue-fillblank--hidden`));
      return;
    }
    (r.classList.add(`cue-reference--hidden`),
      o?.classList.toggle(`cue-proofread--hidden`, D !== `proofread`),
      s?.classList.toggle(`cue-fillblank--hidden`, D !== `fillblank`));
    let l = D === `dictation`,
      u = D === `proofread`;
    (i.classList.toggle(`cue-input--visible`, l),
      c?.classList.toggle(`cue-inline-play--hidden`, u));
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
function kr(e, t) {
  return;
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
      let r = document.createElement(`button`);
      ((r.type = `button`),
        (r.className = `cue-inline-play`),
        r.setAttribute(`aria-label`, `播放第 ${t + 1} 句`),
        (r.title = `播放本句`),
        (r.textContent = `▶`),
        r.addEventListener(`click`, (e) => {
          (e.stopPropagation(), playCueInline(t));
        }));
    let i = document.createElement(`p`);
      ((i.className = `cue cue-reference`),
        (i.innerHTML = pn2(e.text, pe[t] ?? [])),
        i.addEventListener(`click`, (e) => {
          (e.stopPropagation(),
            (practicePageIndex = ue[t] ?? t),
            Rr(),
            (H = t),
            B.forEach((e, n) => e.classList.toggle(`cue-row--active`, n === t)));
        }));
      let a = document.createElement(`textarea`);
      ((a.className = `cue-input`),
        (a.rows = 2),
        (a.placeholder = `第 ${t + 1} 句听写…`),
        a.setAttribute(`aria-label`, `第 ${t + 1} 句听写`),
        (a.spellcheck = !1),
        a.addEventListener(`click`, (e) => e.stopPropagation()));
      let o = document.createElement(`div`);
      ((o.className = `cue-peek`), o.setAttribute(`aria-hidden`, `true`));
      let s = document.createElement(`div`);
      s.className = `cue-proofread cue-proofread--hidden`;
      let c = document.createElement(`div`);
      ((c.className = `cue-fillblank cue-fillblank--hidden`),
        n.appendChild(r),
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
              B.forEach((e, n) => e.classList.toggle(`cue-row--active`, n === t))));
        }),
        y.appendChild(n),
        B.push(n),
        V.push(a));
    }),
    (D = `subtitles`),
    Q());
}
function jr(e) {
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
  ((!v.paused || e > 0) && jr(e), X());
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
    (jr(v.currentTime), X());
  }),
  v.addEventListener(`pause`, () => {
    (stopSpeechPlayback(), X());
  }),
  v.addEventListener(`loadedmetadata`, () => {
    X();
  }),
  v.addEventListener(`durationchange`, () => {
    X();
  }),
  v.addEventListener(`ended`, () => {
    (stopSpeechPlayback(), X());
  }),
  v.addEventListener(`seeked`, () => {
    (D === `fillblank` && z.length && (I = Yn(v.currentTime)),
      (H = -1),
      jr(v.currentTime),
      (v.paused || !z.length) && stopSpeechPlayback(),
      X());
  }),
  b?.addEventListener(`change`, () => {
    if (b?.checked) return;
    speechLoopToken += 1;
    clearSpeechLoopTimer();
  }),
  $e?.addEventListener(`change`, () => {
    v.loop = !!$e.checked;
  }),
  et?.addEventListener(`click`, () => {
    rr();
  }),
  at?.addEventListener(`click`, () => {
    nr();
  }),
  ot?.addEventListener(`click`, () => {
    tr();
  }),
  it?.addEventListener(`change`, () => {
    let e = parseFloat(it.value);
    Number.isFinite(e) && ((v.playbackRate = e), qn().setPlaybackRate(e));
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
    (G.setSeekDragging(!1), X());
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
      D === `proofread` && un());
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
  localStorage.getItem(`kokoro-history-collapsed`) === `1` &&
    (jt?.classList.add(`history-collapsed`),
    Nt && (Nt.hidden = !0),
    Mt?.setAttribute(`aria-expanded`, `false`)),
  Mt?.addEventListener(`click`, () => {
    let e = jt?.classList.toggle(`history-collapsed`) ?? !1;
    (Nt && (Nt.hidden = e),
      Mt?.setAttribute(`aria-expanded`, e ? `false` : `true`),
      localStorage.setItem(ee, e ? `1` : `0`));
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
    if (!(!z.length || !v.src)) {
      if (t?.classList?.contains(`fb-slot`)) {
        if (D !== `fillblank`) return;
        let e = t.closest(`.cue-row`),
          n = e?.dataset.idx == null ? -1 : Number(e.dataset.idx);
        if (n < 0) return;
        (practicePageIndex = ue[n] ?? n), Rr();
        n !== Y(v.currentTime) && Qn(n);
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
          });
      }
    }
  }),
  document.addEventListener(`keydown`, (e) => {
    if (e.repeat) return;
    let t = e.target?.classList?.contains(`cue-input`),
      n = e.target?.classList?.contains(`fb-slot`),
      r = D !== `subtitles`;
    if (n && e.code === `Tab` && D === `fillblank`) {
      if (!z.length || !v.src) return;
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
        if (!v.src) return;
        (e.preventDefault(), e.stopPropagation(), rr());
        return;
      }
      if (e.code === `ArrowLeft`) {
        if (!z.length || !v.src) return;
        (e.preventDefault(), e.stopPropagation(), nr());
        return;
      }
      if (e.code === `ArrowRight`) {
        if (!z.length || !v.src) return;
        (e.preventDefault(), e.stopPropagation(), tr());
        return;
      }
    }
    let i = je(e.target, Ue),
      a = e.ctrlKey || e.altKey;
    if (e.code === `Space`) {
      if (Me(e.target) || t || n || (i && !a) || !v.src) return;
      (e.preventDefault(), rr());
      return;
    }
    if (e.code === `ArrowRight` || e.code === `ArrowLeft`) {
      if (t || n || (i && !a) || Ne(e.target) || !z.length || !v.src) return;
      (e.preventDefault(), e.code === `ArrowRight` ? tr() : nr());
    }
  }),
  Je.addEventListener(`click`, async () => {
    let e = Ue.value.trim();
    if (!e) {
      W(`请先粘贴或输入英文文本。`);
      if (Ue.dataset.practiceOpeningHint === `daily`) {
        delete Ue.dataset.practiceCardChunks;
        delete Ue.dataset.practiceCardKeyPhrases;
        delete Ue.dataset.practiceOpeningHint;
        document.dispatchEvent(new CustomEvent(`app-unblock-ui`));
      }
      return;
    }
    let t2 = practiceGenerateRunCount <= 0;
    practiceGenerateRunCount += 1;
    let n2 = Ue.dataset.practiceOpeningHint === `daily`;
    t2 &&
      !n2 &&
      document.dispatchEvent(
        new CustomEvent(`app-block-ui`, {
          detail: { message: `正在打开练习（首次生成会稍慢）...` },
        }),
      );
    W(t2 ? `正在生成练习（首次生成会稍慢，请稍等）...` : `正在生成练习...`);
    let t = [],
      n = [],
      r2 = [];
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
    let r = Array.isArray(n) && n.length > 0 ? n.map((e) => String(e || ``).trim()).filter(Boolean) : [e],
      i = [],
      a = [];
    for (let e = 0; e < r.length; e++) {
      let t = splitPracticeSentences(r[e]);
      t.length || (t = [r[e]]);
      for (let n of t) {
        let t = String(n || ``).trim();
        t && (i.push(t), a.push(e));
      }
    }
    i.length || (i = splitPracticeSentences(e));
    i.length || (i = [e]);
    i.length !== a.length && (a = i.map((e, t) => t));
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
        ir(),
        (D = `subtitles`),
        (O = {}),
        (k = {}),
        K.clearCurrentHistoryEntryId(),
        Z(),
        or(),
        y.classList.remove(`oio-fillblank-reviewed`),
        (y.innerHTML = ``),
        v.pause(),
        stopSpeechPlayback(),
        tn(),
        v.removeAttribute(`src`),
        v.load());
      let o = buildEstimatedCues(t),
        s = o.length ? o[o.length - 1].end : 1,
        c = buildSilentWavBlob(s + 0.4);
      ((Jt = c),
        (R = URL.createObjectURL(c)),
        (v.src = R),
        v.load(),
        Ar(o, { cueCardIndexList: a, cardCount: Math.max(1, r.length) }),
        X());
      await fn();
      let l = Jn() === `kokoro` ? `Kokoro（失败时自动回退 Web Speech）` : `Web Speech`;
      W(
        `完成。共 ${r.length} 张卡片，${t.length} 句。点句播放将使用当前语音源：${l}。`,
      );
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
      delete Ue.dataset.practiceOpeningHint;
      Je.disabled = !1;
      document.dispatchEvent(new CustomEvent(`app-unblock-ui`));
    }
  }),
  Ye?.addEventListener(`click`, () => {
    ((Ue.value = ``),
      delete Ue.dataset.practiceCardChunks,
      delete Ue.dataset.practiceCardKeyPhrases,
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
      ir(),
      (D = `subtitles`),
      (O = {}),
      (k = {}),
      (A = null),
      K.clearCurrentHistoryEntryId(),
      Z(),
      or(),
      y.classList.remove(`oio-fillblank-reviewed`),
      (y.innerHTML = ``),
      v.pause(),
      stopSpeechPlayback(),
      tn(),
      (Jt = null),
      v.removeAttribute(`src`),
      v.load(),
      X(),
      Q());
  }),
  document.addEventListener(`app-tab-change`, (e) => {
    let t = e?.detail?.tabId;
    if (t === `daily-capture`) return;
    v.pause();
    stopSpeechPlayback();
    clearSpeechLoopTimer();
  }),
  Q(),
  X());
function Nr(e) {
  (St && (St.textContent = e || `导入成功。`), xt?.showModal());
}
function $(e, t) {
  (Tt && (Tt.textContent = e || `导入结果`),
    Et && (Et.textContent = t || ``),
    wt?.showModal());
}
(Ct?.addEventListener(`click`, () => {
  xt?.close();
}),
  Dt?.addEventListener(`click`, () => {
    wt?.close();
  }),
  At?.addEventListener(`click`, () => {
    Ot?.close();
  }));
(($t = new u({
  getCueListMode: () => D,
  getPlaybackCues: () => z,
  setCueListMode: (e) => {
    D = e;
  },
  syncSubtitlePracticeUI: Tr,
  updatePracticeModeButtons: Cr,
})),
  (K = new d({
    dom: {
      granularityEl: w,
      navRoot: T,
      entriesRoot: E,
      contextLabel: C,
      magicCard: Pt,
      quickJumpBtn: Ft,
      jumpDialog: It,
      jumpText: Lt,
      jumpCancel: Rt,
      jumpConfirm: zt,
    },
    getState: () => ({
      granularity: qt,
      weekStart: j,
      year: M,
      month: N,
      selectedDay: P,
      currentEntryId: F,
      jumpDay: L,
    }),
    setState: (next) => {
      Object.prototype.hasOwnProperty.call(next, `granularity`) && (qt = next.granularity);
      Object.prototype.hasOwnProperty.call(next, `weekStart`) && (j = next.weekStart);
      Object.prototype.hasOwnProperty.call(next, `year`) && (M = next.year);
      Object.prototype.hasOwnProperty.call(next, `month`) && (N = next.month);
      Object.prototype.hasOwnProperty.call(next, `selectedDay`) && (P = next.selectedDay);
      Object.prototype.hasOwnProperty.call(next, `currentEntryId`) && (F = next.currentEntryId);
      Object.prototype.hasOwnProperty.call(next, `jumpDay`) && (L = next.jumpDay);
    },
    listSessions: () => Be(),
    buildEntryRow: (row, label, currentId) => wn(row, label, currentId),
    getDayAverage: Bn,
    createAverageRing: Vn,
    attachDayRing: Hn,
    setGranularitySelectValue: (mode) => {
      w && (w.value = mode);
    },
  })),
  K.initDateState(),
  K.setGranularity(`month`),
  K.wireEvents({
    onLoad: async (id) => {
      let e = await Ve(id);
      if (!e?.payload || !e.audioBlob) {
        (W(`记录损坏或已不存在。`), await J());
        return;
      }
      Kn(e.payload, e.audioBlob, { historySessionId: id });
    },
    onDownload: async (id) => {
      await exportCtrl.downloadSingle(id);
    },
    onDelete: async (id) => {
      let e = await Ve(id),
        t = e?.basename || e?.label || `该条记录`;
      if (!confirm(`确定删除本地历史「${t}」？此操作不可恢复。`)) return;
      try {
        (await He(id),
          id === K.getCurrentHistoryEntryId() && K.clearCurrentHistoryEntryId(),
          W(`已从本地历史删除。`));
      } catch (e) {
        (console.error(e), W(`删除失败。`));
      }
      await J();
    },
  }),
  (exportCtrl = new _e({
    dom: {
      openBtn: ft,
      dialog: pt,
      from: mt,
      to: ht,
      applyRange: gt,
      clearRange: _t,
      selectAll: x,
      count: vt,
      list: S,
      cancel: yt,
      confirm: bt,
    },
    setStatus: W,
    listSessions: () => Be(),
    getSession: (id) => Ve(id),
    toLocalDateKeyFromSaved: ie,
    rowMatchesHistoryExportFilter: hn,
    nextExportBasename: nn,
    audioBlobToExtension: an,
    downloadBlob: rn,
  })),
  exportCtrl.wireEvents(),
  (en = new f({
    setStatus: W,
    saveImportedSessionToHistory: yn,
    renderHistoryList: (opts = {}) => K.renderHistoryList(opts),
    showImportSuccessDialog: Nr,
    showImportReportDialog: $,
  })),
  en.wirePracticePackImport(),
  K.renderHistoryList().catch(() => {}));































