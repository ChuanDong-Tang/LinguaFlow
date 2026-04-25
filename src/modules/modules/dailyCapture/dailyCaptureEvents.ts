const DAILY_CAPTURE_UPDATED_EVENT = "daily-capture-updated";

export function emitDailyCaptureUpdated(dateKey: string): void {
  document.dispatchEvent(
    new CustomEvent(DAILY_CAPTURE_UPDATED_EVENT, {
      detail: { dateKey },
    }),
  );
}

export function onDailyCaptureUpdated(handler: (detail: { dateKey?: string }) => void | Promise<void>): void {
  document.addEventListener(DAILY_CAPTURE_UPDATED_EVENT, (event) => {
    const detail = (event as CustomEvent<{ dateKey?: string }>).detail ?? {};
    void handler(detail);
  });
}
