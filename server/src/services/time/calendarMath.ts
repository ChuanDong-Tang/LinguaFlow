export function addCalendarMonthsClamped(base: Date, months: number): Date {
  const targetYear = base.getFullYear();
  const targetMonth = base.getMonth() + months;
  const targetDay = Math.min(base.getDate(), daysInMonth(targetYear, targetMonth));
  const next = new Date(base);

  next.setFullYear(targetYear, targetMonth, targetDay);
  return next;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
