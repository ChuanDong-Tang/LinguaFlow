export function tokenizeWords(s) {
  return String(s).trim().split(/\s+/).filter(Boolean);
}

export function normFillToken(w) {
  return w
    .replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, "")
    .toLowerCase();
}

export function normFillAnswer(s) {
  return normFillToken(String(s).trim());
}

export function formatClockSec(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
