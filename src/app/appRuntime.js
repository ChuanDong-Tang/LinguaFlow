import { getDomRefs as p } from "./domRefs.js";
import { ModelController as r } from "./modelLoader.js";
import { VoiceController as c } from "./voiceController.js";
import { PlayerController as l } from "./PlayerController.js";
import { PracticeController as u } from "./PracticeController.js";
import { HistoryController as d } from "./HistoryController.js";
import { HistoryExportController as _e } from "./HistoryExportController.js";
import { ImportExportController as f } from "./ImportExportController.js";
import { PEEK_MS as m, EXPORT_SCHEMA_VERSION as h, HISTORY_COLLAPSE_KEY as ee } from "./constants.js";
import { saveSession as Re, listSessions as Be, getSession as Ve, deleteSession as He } from "../historyIdb.js";
import { toLocalDateKeyFromSaved as ie, savedAtIsoForImportedBasename as oe } from "./dateUtils.js";
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
    practiceActionsBar: ct,
    fillblankCheckBtn: lt,
    fillblankSaveStatesBtn: ut,
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
  H = -1,
  U = 0,
  Yt = new Map(),
  Xt = null;
function W(e) {
  Xe && (Xe.textContent = e ?? ``);
}
var Zt = new c({
  voiceComboboxEl: We,
  voiceComboboxTrigger: Ge,
  voiceComboboxValue: Ke,
  voiceComboboxList: qe,
});
Zt.init();
var Qt = new r({ setStatus: W }),
  G = new l({
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
    for (let e = 0; e < r.length; e++)
      n
        .querySelector(`.pr-word[data-si="${t}"][data-wi="${e}"]`)
        ?.classList.contains(`pr-word--selected`) && i.push(e);
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
  for (let e = 0; e < n.length; e++)
    s.has(e)
      ? (a(), r.push({ type: `blank`, answer: n[e], wordIndex: e }))
      : i.push(n[e]);
  return (a(), r);
}
function un() {
  O = on();
}
async function fn() {
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
    return (await Re(r), K.markSessionSaved(r.savedAt, r.id), await J(), t);
  } catch (e) {
    return (console.error(e), null);
  }
}

async function yn(e, t, n) {
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
  let u = document.createElement(`button`);
  ((u.type = `button`),
    (u.className = `history-act-dl`),
    (u.textContent = `下载`),
    (u.dataset.historyDownload = e.id));
  let d = document.createElement(`button`);
  return (
    (d.type = `button`),
    (d.className = `history-act-del`),
    (d.textContent = `删除`),
    (d.dataset.historyDelete = e.id),
    s.appendChild(l),
    s.appendChild(u),
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
      Number.isFinite(t) && t >= 0 && t < a.length && r.push(`${n}:${t}`);
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
async function qn(e) {
  if (e.length === 0) throw Error(`没有生成任何音频片段`);
  let n = e[0].sampling_rate,
    r = e.reduce((e, t) => e + t.audio.length, 0),
    i = new Float32Array(r),
    a = 0;
  for (let t of e) (i.set(t.audio, a), (a += t.audio.length));
  let { RawAudio: o } = await t(
    async () => {
      let { RawAudio: e } = await import("@huggingface/transformers").then(
        (e) => e.o,
      );
      return { RawAudio: e };
    },
    __vite__mapDeps([3, 2]),
  );
  return new o(i, n);
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
async function Jn(e, t, n, r) {
  let i = isMobileGenerationClient(),
    a = i ? 120 : 220,
    o = i ? 1 : 3,
    s = buildTtsChunkPlan(t, a),
    c = s.reduce((e, t) => e + t.chunks.length, 0),
    l = [],
    u = [],
    d = 0,
    f = 0,
    p = 0;
  for (let h = 0; h < s.length; h++) {
    let m = s[h],
      C = d;
    for (let b = 0; b < m.chunks.length; b++) {
      let I = m.chunks[b],
        T = c > s.length ? `，总进度 ${p + 1} / ${c}` : ``;
      W(`正在合成语音…（${h + 1} / ${s.length} 句，第 ${b + 1} / ${m.chunks.length} 段${T}）`);
      let E = await e.generate(I, { voice: n, speed: r });
      f || (f = E.sampling_rate), (p += 1), (d += E.audio.length), l.push(E), p % o === 0 && (await yieldToMainThread());
    }
    let g = f ? C / f : 0,
      y = f ? d / f : 0;
    (u.push({ start: g, end: y, text: m.text }), await yieldToMainThread());
  }
  return { merged: await qn(l), cues: u };
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
function $n(e) {
  if (!e) return null;
  let t = e.querySelectorAll(`.fb-slot`);
  for (let e of t) if (!e.readOnly) return e;
  return t[0] ?? null;
}
function er(e) {
  G.seekToCue(e);
}
function tr() {
  G.goNextCue();
}
function nr() {
  G.goPrevCue();
}
function rr() {
  G.togglePlayPause();
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
    r = e && t === `fillblank`;
  (dt && (dt.hidden = !n),
    lt && (lt.hidden = !r),
    ut && (ut.hidden = !r),
    (ct.hidden = !n && !r));
}
async function sr() {
  if (!z.length) return { ok: !1, reason: `no-cues` };
  let e = K.getCurrentHistoryEntryId();
  if (!e) return { ok: !1, reason: `no-active-id` };
  let t = await Ve(e);
  return !t?.payload || !t.audioBlob
    ? { ok: !1, reason: `bad-row` }
    : ((t.payload = Pn()),
      (t.savedAt = new Date().toISOString()),
      await Re(t),
      await J(),
      { ok: !0, reason: `updated` });
}
async function cr(e) {
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
          (t = `已新建本地历史「${e}」并写入；之后可用「确认创建」或「更新填空状态」继续更新同一条。`))
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
function lr() {
  y.classList.remove(`oio-fillblank-reviewed`);
}
function ur(e) {
  (kt && (kt.textContent = e), Ot?.showModal());
}
async function dr() {
  if (D !== `fillblank` || !z.length) return;
  (Wn(), Un());
  let { outcome: e } = await cr(`已更新填空状态。`);
  lr();
  let t = ``;
  ((t =
    e === `history`
      ? `已写入本地历史。已回到可作答状态；再点「检查填空」可校对，○ / ✕ / ✓ 仅在校对后出现。`
      : e === `new-history`
        ? `已新建本地历史并保存。已回到可作答状态，需要时再点「检查填空」。`
        : e === `page-only`
          ? `进度仅保留在本页，未写入本地历史。已回到可作答状态；请尽量关联历史或保留音频后再更新。`
          : `保存异常，请看底部状态栏。已退出校对条，可继续在本页练习。`),
    ur(t));
}
async function fr() {
  D !== `proofread` ||
    !z.length ||
    (un(), Wt(O), Ht(O), (A = null), await cr(`已确认创建。`));
}
function pr(e) {
  let t = e?.closest?.(`.fb-slot-wrap`);
  if (!t) return;
  let n = e.classList.contains(`fb-slot--ok`),
    r = e.classList.contains(`fb-slot--wrong`),
    i = !n && !r;
  t.querySelectorAll(`.fb-state-btn`).forEach((e) => {
    let t = e.dataset.fbState,
      a = (t === `pending` && i) || (t === `wrong` && r) || (t === `ok` && n);
    e.classList.toggle(`fb-state-btn--active`, !!a);
  });
}
function mr(e, t) {
  if (!e?.classList?.contains(`fb-slot`)) return;
  let n = e.dataset.fbRevealed === `1`;
  t === `pending`
    ? ((e.readOnly = !1),
      delete e.dataset.fbRevealed,
      e.classList.remove(`fb-slot--revealed`),
      e.classList.remove(`fb-slot--ok`, `fb-slot--wrong`),
      n && (e.value = ``))
    : t === `wrong`
      ? ((e.readOnly = !1),
        delete e.dataset.fbRevealed,
        e.classList.remove(`fb-slot--revealed`),
        e.classList.remove(`fb-slot--ok`),
        e.classList.add(`fb-slot--wrong`),
        n && (e.value = ``))
      : t === `ok` &&
        (e.classList.remove(`fb-slot--wrong`),
        e.classList.add(`fb-slot--ok`),
        (e.readOnly = !0),
        (e.dataset.fbRevealed = `1`),
        e.classList.add(`fb-slot--revealed`),
        (e.value = e.dataset.answer ?? ``));
}
function hr() {
  (y.classList.add(`oio-fillblank-reviewed`),
    y.querySelectorAll(`.fb-slot`).forEach((e) => {
      if (e.dataset.fbRevealed === `1`) {
        (e.classList.remove(`fb-slot--wrong`),
          e.classList.add(`fb-slot--ok`),
          pr(e));
        return;
      }
      e.classList.remove(`fb-slot--wrong`, `fb-slot--ok`);
      let t = e.dataset.answer ?? ``,
        n = e.value,
        r = Ce(n),
        i = Ce(t);
      (r === `` || r !== i
        ? e.classList.add(`fb-slot--wrong`)
        : e.classList.add(`fb-slot--ok`),
        pr(e));
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
    let n = document.createElement(`div`);
    ((n.className = `pr-user-line`), (n.textContent = V[e]?.value ?? ``));
    let r = document.createElement(`div`);
    ((r.className = `pr-ref-line`),
      xe(z[e].text.trim()).forEach((t, n) => {
        n > 0 && r.appendChild(document.createTextNode(` `));
        let i = document.createElement(`span`);
        ((i.className = `pr-word`),
          (i.dataset.si = String(e)),
          (i.dataset.wi = String(n)),
          (i.textContent = t),
          r.appendChild(i));
      }),
      t.appendChild(n),
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
        let e = document.createElement(`span`);
        ((e.className = `fb-text`), (e.textContent = t.text), i.appendChild(e));
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
        ((d.className = `fb-slot-actions`),
          d.setAttribute(`role`, `group`),
          d.setAttribute(`aria-label`, `手动标记本题状态`));
        for (let { state: e, sym: t, title: n, kindClass: r } of [
          {
            state: `pending`,
            sym: `○`,
            title: `待练（蓝）`,
            kindClass: `fb-state-btn--pending`,
          },
          {
            state: `wrong`,
            sym: `✕`,
            title: `错误（红）`,
            kindClass: `fb-state-btn--wrong`,
          },
          {
            state: `ok`,
            sym: `✓`,
            title: `已掌握（绿）`,
            kindClass: `fb-state-btn--ok`,
          },
        ]) {
          let i = document.createElement(`button`);
          ((i.type = `button`),
            (i.className = `fb-state-btn ${r}`),
            (i.dataset.fbState = e),
            (i.textContent = t),
            i.setAttribute(`aria-label`, n),
            (i.title = n),
            i.addEventListener(`mousedown`, (e) => {
              e.stopPropagation();
            }),
            i.addEventListener(`click`, (e) => {
              (e.preventDefault(),
                e.stopPropagation(),
                y.classList.contains(`oio-fillblank-reviewed`) &&
                  (mr(s, i.dataset.fbState), pr(s)));
            }),
            d.appendChild(i));
        }
        (o.appendChild(s), o.appendChild(d), i.appendChild(o), pr(s));
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
      s = t.querySelector(`.cue-fillblank`);
    if (!e) {
      (r.classList.remove(`cue-reference--hidden`),
        i.classList.remove(`cue-input--visible`),
        a.classList.remove(`cue-peek--visible`),
        o?.classList.add(`cue-proofread--hidden`),
        s?.classList.add(`cue-fillblank--hidden`));
      return;
    }
    (r.classList.add(`cue-reference--hidden`),
      o?.classList.toggle(`cue-proofread--hidden`, D !== `proofread`),
      s?.classList.toggle(`cue-fillblank--hidden`, D !== `fillblank`));
    let c = D === `dictation`;
    i.classList.toggle(`cue-input--visible`, c);
  }),
    e || Z(),
    or(),
    D !== `fillblank` && (I = -1),
    st && ((st.hidden = !z.length), Er()));
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
  if (D === `subtitles` || e < 0 || D === `fillblank`) return;
  let n = document.activeElement;
  if (n !== Ue && D === `dictation`) {
    if (n?.classList?.contains(`cue-input`)) {
      let r = n.closest(`.cue-row`),
        i = r?.dataset.idx == null ? -1 : Number(r.dataset.idx);
      if (i !== t && i !== e) return;
    }
    V[e]?.focus({ preventScroll: !0 });
  }
}
function Ar(e) {
  ((z = e),
    (H = -1),
    (U = 0),
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
      let r = document.createElement(`p`);
      ((r.className = `cue cue-reference`),
        (r.textContent = e.text),
        r.addEventListener(`click`, (e) => {
          (e.stopPropagation(), D === `proofread` ? Qn(t) : er(t));
        }));
      let i = document.createElement(`textarea`);
      ((i.className = `cue-input`),
        (i.rows = 2),
        (i.placeholder = `第 ${t + 1} 句听写…`),
        i.setAttribute(`aria-label`, `第 ${t + 1} 句听写`),
        (i.spellcheck = !1),
        i.addEventListener(`click`, (e) => e.stopPropagation()));
      let a = document.createElement(`div`);
      ((a.className = `cue-peek`), a.setAttribute(`aria-hidden`, `true`));
      let o = document.createElement(`div`);
      o.className = `cue-proofread cue-proofread--hidden`;
      let s = document.createElement(`div`);
      ((s.className = `cue-fillblank cue-fillblank--hidden`),
        n.appendChild(r),
        n.appendChild(i),
        n.appendChild(a),
        n.appendChild(o),
        n.appendChild(s),
        n.addEventListener(`click`, (e) => {
          D !== `subtitles` &&
            (Gt(e)?.closest?.(`.fb-state-btn, .fb-slot-actions`) ||
              (D === `proofread` ? Qn(t) : er(t)));
        }),
        y.appendChild(n),
        B.push(n),
        V.push(i));
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
    let e = H;
    for (let e = 0; e < B.length; e++)
      B[e].classList.toggle(`cue-row--active`, e === t);
    (t >= 0 && B[t].scrollIntoView({ block: `center`, behavior: `smooth` }),
      kr(t, e),
      (H = t));
  }
}
(v.addEventListener(`timeupdate`, () => {
  let e = v.currentTime,
    t = D === `fillblank`;
  if (!t && b?.checked && z.length > 0 && U >= 0 && U < z.length) {
    let t = z[U];
    if (e >= t.end - 0.06) {
      v.currentTime = t.start;
      return;
    }
  }
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
    X();
  }),
  v.addEventListener(`loadedmetadata`, () => {
    X();
  }),
  v.addEventListener(`durationchange`, () => {
    X();
  }),
  v.addEventListener(`ended`, () => {
    X();
  }),
  v.addEventListener(`seeked`, () => {
    (b?.checked && z.length && (U = Y(v.currentTime)),
      D === `fillblank` && z.length && (I = Yn(v.currentTime)),
      (H = -1),
      jr(v.currentTime),
      X());
  }),
  b?.addEventListener(`change`, () => {
    b?.checked && z.length && v.src && (U = Y(v.currentTime));
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
    Number.isFinite(e) && (v.playbackRate = e);
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
      !y.contains(t) ||
      (e.stopPropagation(),
      t.classList.toggle(`pr-word--selected`),
      D === `proofread` && un());
  }),
  lt?.addEventListener(`click`, () => {
    Mr().catch((e) => {
      (console.error(e), W(`记录填空正确率失败，请稍后再试。`));
    });
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
(ut?.addEventListener(`click`, () => {
  dr().catch((e) => {
    (console.error(e), W(`更新填空状态失败，请稍后再试。`));
  });
}),
  dt?.addEventListener(`click`, () => {
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
    t?.classList?.contains(`fb-slot`) &&
      (t.readOnly || t.classList.remove(`fb-slot--wrong`, `fb-slot--ok`));
  }),
  y.addEventListener(`focusin`, (e) => {
    let t = e.target;
    if (!(!z.length || !v.src)) {
      if (t?.classList?.contains(`fb-slot`)) {
        if (D !== `fillblank`) return;
        let e = t.closest(`.cue-row`),
          n = e?.dataset.idx == null ? -1 : Number(e.dataset.idx);
        if (n < 0) return;
        n !== Y(v.currentTime) && Qn(n);
        return;
      }
      if (t?.classList?.contains(`cue-input`) && D === `dictation`) {
        let e = t.closest(`.cue-row`),
          n = e?.dataset.idx == null ? -1 : Number(e.dataset.idx);
        if (n < 0) return;
        n !== Y(v.currentTime) && er(n);
      }
    }
  }),
  document.addEventListener(`keydown`, (e) => {
    if (e.repeat) return;
    let t = e.target?.classList?.contains(`cue-input`),
      n = e.target?.classList?.contains(`fb-slot`),
      r = D !== `subtitles`;
    if (t && e.code === `Tab` && D === `dictation`) {
      if (!z.length || !v.src) return;
      (e.preventDefault(), e.stopPropagation());
      let t = e.target.closest(`.cue-row`),
        n = t?.dataset.idx == null ? -1 : Number(t.dataset.idx);
      if (n < 0) return;
      e.shiftKey ? n > 0 && er(n - 1) : n < z.length - 1 && er(n + 1);
      return;
    }
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
    if ((t || n) && e.ctrlKey && e.shiftKey) {
      if (e.code === `ArrowUp`) {
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
      return;
    }
    let t = ge(e);
    ((Je.disabled = !0),
      (z = []),
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
      tn(),
      v.removeAttribute(`src`),
      v.load());
    try {
      let { merged: e, cues: n } = await Jn(
          await Qt.loadModel(),
          t,
          Zt.getSelectedVoiceId(),
          1,
        ),
        r = e.toBlob();
      ((Jt = r),
        (R = URL.createObjectURL(r)),
        (v.src = R),
        v.load(),
        Ar(n),
        X());
      let i = await fn();
      W(
        i
          ? `完成。共 ${t.length} 句。已自动写入本地历史 ${i}。可在字幕区选「听写」等开始练习。`
          : `完成。共 ${t.length} 句。本地历史未写入（请检查浏览器是否允许本站存储数据，或稍后重试生成）。可在字幕区选「听写」等开始练习。`,
      );
    } catch (e) {
      (console.error(e),
        W(
          e?.message
            ? `出错：${e.message}`
            : `生成失败，请打开控制台查看详情。`,
        ));
    } finally {
      Je.disabled = !1;
    }
  }),
  Ye?.addEventListener(`click`, () => {
    ((Ue.value = ``),
      W(``),
      (z = []),
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
      tn(),
      (Jt = null),
      v.removeAttribute(`src`),
      v.load(),
      X(),
      Q());
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































