import { toDateKey } from "../../domain/chat/messageState";

export function getMonthRange(cursor: Date): { monthKey: string; fromDateKey: string; toDateKey: string } {
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);

  return {
    monthKey: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
    fromDateKey: toDateKey(firstDay),
    toDateKey: toDateKey(lastDay),
  };
}

export function selectedDateLabelText(d: Date, todayDateKey = toDateKey(new Date())): string {
  if (toDateKey(d) === todayDateKey) {
    return "今天";
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
