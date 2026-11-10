/**
 * A photo's own capture time, as an ISO string. Memory cards show this time in
 * the detail view, while the home feed keeps the time the memory was sent.
 */

/** EXIF "YYYY:MM:DD HH:MM:SS" (+ optional "+08:00" offset) → ISO, or null. */
export function exifCaptureTime(exif: Record<string, unknown> | null | undefined): string | null {
  if (!exif) return null;
  const raw = [exif.DateTimeOriginal, exif.DateTimeDigitized, exif.DateTime]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const match = raw?.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/u);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as [number, number, number, number, number, number, number];
  const offset = [exif.OffsetTimeOriginal, exif.OffsetTime]
    .find((value): value is string => typeof value === "string" && /^[+-]\d{2}:\d{2}$/u.test(value));
  // Without an offset EXIF time is the camera's local wall clock; read it as device-local.
  const time = offset
    ? Date.UTC(y, mo - 1, d, h, mi, s) - offsetMinutes(offset) * 60_000
    : new Date(y, mo - 1, d, h, mi, s).getTime();
  return plausibleCaptureTime(time);
}

/** Library timestamp in ms (0 / missing → null). */
export function libraryCaptureTime(ms: number | null | undefined): string | null {
  return typeof ms === "number" && ms > 0 ? plausibleCaptureTime(ms) : null;
}

function plausibleCaptureTime(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < Date.UTC(1990, 0, 1) || ms > Date.now() + 24 * 60 * 60 * 1000) return null;
  return new Date(ms).toISOString();
}

function offsetMinutes(offset: string): number {
  const sign = offset.startsWith("-") ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(":").map(Number) as [number, number];
  return sign * (hours * 60 + minutes);
}

export type PickedImageSource = { uri: string; width: number; height: number; capturedAt?: string | null; sourceAssetId?: string | null };

/** Image-picker result → upload source, keeping when it was taken and where it came from. */
export function pickedImageSource(
  asset: { uri: string; width: number; height: number; exif?: Record<string, unknown> | null; assetId?: string | null },
  fromCamera: boolean,
): PickedImageSource {
  return {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    capturedAt: fromCamera ? new Date().toISOString() : exifCaptureTime(asset.exif),
    sourceAssetId: fromCamera ? null : asset.assetId ?? null,
  };
}
