// 今日 tab days (2026-11 feedback): step back through recent days, jump to any
// day from the calendar, and "this day in history" shortcuts.

export function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayOf(key: string): Date { return new Date(`${key}T12:00:00`); }

export function shiftDay(key: string, days: number): string {
  const date = dayOf(key);
  date.setDate(date.getDate() + days);
  return dateKeyOf(date);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((dayOf(to).getTime() - dayOf(from).getTime()) / 86_400_000);
}

/** Header label for the 今日 tab: 今日 / 昨天 / 前天 / N天前 (other locales likewise). */
export function relativeDayLabel(day: string, today: string, locale: string): string {
  const ago = Math.max(0, daysBetween(day, today));
  const zh = locale.startsWith("zh");
  const ja = locale.startsWith("ja");
  if (ago === 0) return zh || ja ? "今日" : "Today";
  if (ago === 1) return zh ? (locale === "zh-TW" ? "昨天" : "昨天") : ja ? "昨日" : "Yesterday";
  if (ago === 2) return zh ? "前天" : ja ? "一昨日" : "2 days ago";
  return zh ? `${ago}天前` : ja ? `${ago}日前` : `${ago} days ago`;
}

export type HistoryDay = { key: string; dateKey: string };

/** 1 week / 1 month / 1–3 years before today (same calendar day; Feb 29 falls back to Feb 28). */
export function historyDays(today: string): HistoryDay[] {
  const base = dayOf(today);
  const monthsBack = (months: number) => {
    const date = new Date(base.getFullYear(), base.getMonth() - months, 1, 12);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(base.getDate(), lastDay));
    return dateKeyOf(date);
  };
  return [
    { key: "week", dateKey: shiftDay(today, -7) },
    { key: "month", dateKey: monthsBack(1) },
    { key: "year1", dateKey: monthsBack(12) },
    { key: "year2", dateKey: monthsBack(24) },
    { key: "year3", dateKey: monthsBack(36) },
  ];
}
