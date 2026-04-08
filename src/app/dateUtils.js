export function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function dateToLocalKey(d) {
  const x = startOfLocalDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function toLocalDateKeyFromSaved(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return dateToLocalKey(t);
}

/**
 * 从导入主文件名解析日历日：优先 `YYYY-MM-DD-NNN`（与本站导出一致），
 * 也接受月日少前导零的 `YYYY-M-D-NNN`。无法解析则返回 null（导入时用「当天」）。
 */
export function localDateKeyFromExportBasename(basename) {
  const s = String(basename ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{3})$/);
  if (!m) m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})-(\d{3})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dateToLocalKey(dt);
}

/** 导入写入历史时的 savedAt：能解析主文件名则用该日本地正午，否则为当前时刻。 */
export function savedAtIsoForImportedBasename(basename) {
  const key = localDateKeyFromExportBasename(basename);
  if (!key) return new Date().toISOString();
  const parts = key.split("-").map(Number);
  const y = parts[0];
  const mo = parts[1];
  const d = parts[2];
  const localNoon = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (
    localNoon.getFullYear() !== y ||
    localNoon.getMonth() !== mo - 1 ||
    localNoon.getDate() !== d
  ) {
    return new Date().toISOString();
  }
  return localNoon.toISOString();
}

/** 周一开始的一周（本地时区） */
export function startOfLocalWeekMonday(d) {
  const x = startOfLocalDay(d);
  const dow = x.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + offset);
  return x;
}

export function addDaysDate(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonthsClamp(d, delta) {
  const x = new Date(d);
  const day = x.getDate();
  x.setMonth(x.getMonth() + delta);
  if (x.getDate() < day) x.setDate(0);
  return x;
}

export function addYearsClamp(d, delta) {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + delta);
  return x;
}

export function formatKeyToSlashDisplay(key) {
  if (!key) return "";
  const p = key.split("-");
  if (p.length !== 3) return "";
  const [y, mo, d] = p;
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(mo) || !/^\d{2}$/.test(d)) return "";
  return `${y} / ${mo} / ${d}`;
}

export function parseSlashDateInput(raw) {
  const compact = raw.trim().replace(/\s*\/\s*/g, "/").replace(/\s*-\s*/g, "-");
  const m = compact.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dateToLocalKey(dt);
}

export function formatZhDateLong(d) {
  try {
    return d.toLocaleDateString("zh-Hans-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateToLocalKey(d);
  }
}
