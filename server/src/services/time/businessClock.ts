import { getRuntimeConfig } from "../../config/runtimeConfig.js";

export type BusinessClockSnapshot = {
  serverNowIso: string;
  businessTimeZone: string;
  businessDateKey: string;
};

export function getBusinessClockSnapshot(now = new Date()): BusinessClockSnapshot {
  const businessTimeZone = getRuntimeConfig().quotaTimeZone;
  return {
    serverNowIso: now.toISOString(),
    businessTimeZone,
    businessDateKey: formatDateKeyInTimeZone(now, businessTimeZone),
  };
}

export function formatDateKeyInTimeZone(date: Date, timeZone = getRuntimeConfig().quotaTimeZone): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function dateKeyRangeInBusinessTimeZone(dateKey: string): { start: Date; end: Date } {
  return {
    start: dateKeyToUtcDate(dateKey, 0, 0, 0, 0),
    end: dateKeyToUtcDate(dateKey, 23, 59, 59, 999),
  };
}

function dateKeyToUtcDate(dateKey: string, hour: number, minute: number, second: number, millisecond: number): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error(`Invalid dateKey: ${dateKey}`);
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  const offsetMs = getTimeZoneOffsetMs(utc, getRuntimeConfig().quotaTimeZone);
  return new Date(utc.getTime() - offsetMs);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return asUtc - date.getTime();
}
