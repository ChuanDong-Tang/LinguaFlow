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
