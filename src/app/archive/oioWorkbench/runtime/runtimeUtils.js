import { EXPORT_SCHEMA_VERSION, FILL_BLANK_TIER_LABEL_ZH } from "./constants.js";
import { toLocalDateKeyFromSaved } from "../../../dateUtils.js";

/** @param {number} percent 已取整 0–100 */
export function fillBlankAccuracyTierFromPercent(percent) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent))));
  if (p >= 100) return "perfect";
  if (p >= 80) return "high";
  if (p >= 50) return "mid";
  return "weak";
}

export function fillBlankTierLabelZh(tier) {
  return FILL_BLANK_TIER_LABEL_ZH[tier] ?? tier;
}

export function fingerprintBlankMap(map) {
  try {
    return JSON.stringify(map ?? {});
  } catch {
    return "";
  }
}

export function validFillBlankStateKeySetFromMap(map) {
  const valid = new Set();
  if (!map || typeof map !== "object") return valid;
  for (const [si, indices] of Object.entries(map)) {
    const i = Number(si);
    if (!Number.isFinite(i)) continue;
    const arr = Array.isArray(indices) ? indices : [];
    for (const wi of arr) {
      const j = Number(wi);
      if (Number.isFinite(j)) valid.add(`${i}:${j}`);
    }
  }
  return valid;
}

export function eventTargetElement(ev) {
  const t = ev?.target;
  return t instanceof Element ? t : t?.parentElement ?? null;
}

export function nextExportBasename() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dateKey = `${y}-${m}-${day}`;
  const storageKey = `kokoro-export-count-${dateKey}`;
  const n = Number(sessionStorage.getItem(storageKey) || "0") + 1;
  sessionStorage.setItem(storageKey, String(n));
  const seq = String(n).padStart(3, "0");
  return `${dateKey}-${seq}`;
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export function audioBlobToExtension(blob) {
  const t = blob.type || "";
  if (t.includes("wav") || t.includes("wave")) return "wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("webm")) return "webm";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("mp4") || t.includes("m4a")) return "m4a";
  return "wav";
}

export function cloneBlankMap(src) {
  const out = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, v] of Object.entries(src)) {
    out[k] = Array.isArray(v) ? [...v] : [];
  }
  return out;
}

/** 列表副标题：原文首行预览 */
export function makeHistoryPreview(sourceText) {
  const line = String(sourceText || "")
    .trim()
    .split(/\r?\n/)[0]
    .trim()
    .replace(/\s+/g, " ");
  if (!line) return "";
  return line.length > 44 ? `${line.slice(0, 42)}…` : line;
}

export function rowMatchesHistoryExportFilter(row, fromVal, toVal) {
  const key = toLocalDateKeyFromSaved(row?.savedAt || "");
  if (!key) return false;
  if (fromVal && key < fromVal) return false;
  if (toVal && key > toVal) return false;
  return true;
}

export function normalizeFillBlankAccuracy(raw) {
  if (!raw || typeof raw !== "object") return null;
  const total = Number(raw.totalBlanks);
  const correct = Number(raw.correctBlanks);
  const percentRaw = Number(raw.percent);
  if (!Number.isFinite(total) || total < 0) return null;
  if (!Number.isFinite(correct) || correct < 0 || correct > total) return null;
  const pct = Number.isFinite(percentRaw)
    ? Math.max(0, Math.min(100, Math.round(percentRaw)))
    : total > 0
      ? Math.round((correct / total) * 100)
      : 0;
  const tier = fillBlankAccuracyTierFromPercent(pct);
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString();
  return { totalBlanks: total, correctBlanks: correct, percent: pct, tier, updatedAt };
}

export function hasAnyGradedFillBlankSlot(states) {
  if (!states || typeof states !== "object") return false;
  return Object.values(states).some((v) => v === "ok" || v === "wrong");
}

export function collectBlankSlotKeysFromProofread(blanksMap, cues) {
  const keys = new Set();
  if (!blanksMap || typeof blanksMap !== "object" || !Array.isArray(cues)) return keys;
  for (const [si, arr] of Object.entries(blanksMap)) {
    const i = Number(si);
    if (!Number.isFinite(i) || !cues[i]) continue;
    const words = String(cues[i].text ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const selected = Array.isArray(arr) ? arr : [];
    for (const wi of selected) {
      const j = Number(wi);
      if (Number.isFinite(j) && j >= 0 && j < words.length) keys.add(`${i}:${j}`);
    }
  }
  return keys;
}

export function averageFillBlankPercentForSessions(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const nums = [];
  for (const r of rows) {
    const acc = normalizeFillBlankAccuracy(r?.payload?.fillBlankAccuracy);
    if (acc && Number.isFinite(acc.percent)) nums.push(acc.percent);
  }
  if (!nums.length) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.max(0, Math.min(100, Math.round(avg)));
}

export function isImportJsonFile(f) {
  const n = String(f?.name || "").toLowerCase();
  const t = String(f?.type || "").toLowerCase();
  return n.endsWith(".json") || t.includes("json");
}

export function isImportAudioFile(f) {
  const n = String(f?.name || "").toLowerCase();
  const t = String(f?.type || "").toLowerCase();
  return /\.(wav|mp3|webm|ogg|m4a|aac|flac)$/i.test(n) || t.startsWith("audio/");
}

export function importFileStem(f) {
  const n = String(f?.name || "").trim();
  if (!n) return "";
  const lower = n.toLowerCase();
  if (lower.endsWith(".json")) return n.slice(0, -5);
  const m = n.match(/^(.*)\.(wav|mp3|webm|ogg|m4a|aac|flac)$/i);
  if (m) return m[1];
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(0, i) : n;
}

export function buildImportPairs(fileList) {
  const jsonByStem = new Map();
  const audioByStem = new Map();
  const others = [];

  for (const f of fileList) {
    const stem = importFileStem(f);
    if (!stem) {
      others.push(f);
      continue;
    }
    if (isImportJsonFile(f)) {
      if (!jsonByStem.has(stem)) jsonByStem.set(stem, []);
      jsonByStem.get(stem).push(f);
      continue;
    }
    if (isImportAudioFile(f)) {
      if (!audioByStem.has(stem)) audioByStem.set(stem, []);
      audioByStem.get(stem).push(f);
      continue;
    }
    others.push(f);
  }

  if (others.length) {
    return { error: `包含不支持的文件类型：${others.map((f) => f.name).join("、")}` };
  }

  const stems = new Set([...jsonByStem.keys(), ...audioByStem.keys()]);
  const pairs = [];
  const unmatchedJson = [];
  const unmatchedAudio = [];

  for (const stem of stems) {
    const js = jsonByStem.get(stem) ?? [];
    const as = audioByStem.get(stem) ?? [];
    if (js.length !== 1 || as.length !== 1) {
      if (js.length !== 1 && js.length) unmatchedJson.push(...js);
      if (as.length !== 1 && as.length) unmatchedAudio.push(...as);
      if (js.length === 1 && as.length === 0) unmatchedJson.push(js[0]);
      if (as.length === 1 && js.length === 0) unmatchedAudio.push(as[0]);
      continue;
    }
    pairs.push({ stem, jsonFile: js[0], audioFile: as[0] });
  }

  return { pairs, unmatchedJson, unmatchedAudio };
}

export function validateImportPayload(raw) {
  if (!raw || typeof raw !== "object") return "JSON 顶层必须是对象。";
  if (raw.schemaVersion && raw.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    return `不支持的 schemaVersion：${raw.schemaVersion}（需要 ${EXPORT_SCHEMA_VERSION}）`;
  }
  if (!Array.isArray(raw.cues) || raw.cues.length === 0) return "cues 缺失或为空。";
  for (let i = 0; i < raw.cues.length; i++) {
    const c = raw.cues[i];
    if (!c || typeof c !== "object") return `cues[${i}] 非对象。`;
    if (typeof c.text !== "string") return `cues[${i}].text 缺失。`;
    if (!Number.isFinite(Number(c.start)) || !Number.isFinite(Number(c.end))) {
      return `cues[${i}] 的 start/end 非数字。`;
    }
  }
  return "";
}

export function importOrphanNote(unmatchedJson, unmatchedAudio) {
  const bits = [];
  if (unmatchedJson.length) bits.push(`${unmatchedJson.length} 个未配对 JSON`);
  if (unmatchedAudio.length) bits.push(`${unmatchedAudio.length} 个未配对音频`);
  return bits.length ? `（已忽略：${bits.join("、")}，请检查主文件名是否一致）` : "";
}

export function isTypingField(target, textEl) {
  return (
    target === textEl ||
    target?.classList?.contains("cue-input") ||
    target?.classList?.contains("fb-slot")
  );
}

export function isSpaceReservedControl(target) {
  const tag = target.tagName;
  if (tag === "BUTTON") return true;
  if (tag === "INPUT") {
    const type = target.type;
    return type === "checkbox" || type === "radio" || type === "submit" || type === "file";
  }
  return tag === "SELECT";
}

export function isArrowReservedControl(target) {
  return target.tagName === "SELECT";
}
