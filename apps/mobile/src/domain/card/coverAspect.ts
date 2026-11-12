/**
 * Home grid cover shape: the photo's own ratio, clamped to 3:4 … 5:4. The cover
 * editor uses the same frame so what you pick is exactly what the card shows.
 */
export function homeCoverAspect(width: number | undefined, height: number | undefined): number {
  const ratio = Math.max(1, width ?? 1) / Math.max(1, height ?? 1);
  return Math.max(0.75, Math.min(1.25, ratio));
}

/** Position a `cover`-filled image inside a frame, honoring the chosen focus (0–1). */
export function focusedCoverRect(source: { width: number; height: number }, frame: { width: number; height: number }, focus: { x?: number; y?: number }) {
  const scale = Math.max(frame.width / Math.max(1, source.width), frame.height / Math.max(1, source.height));
  const width = source.width * scale;
  const height = source.height * scale;
  const clamp = (value: number | undefined) => Math.max(0, Math.min(1, value ?? 0.5));
  return { left: -(width - frame.width) * clamp(focus.x), top: -(height - frame.height) * clamp(focus.y), width, height };
}
