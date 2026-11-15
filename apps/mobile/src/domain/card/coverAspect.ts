/**
 * Home 瀑布 cover shape: the photo's own ratio, clamped to 2:3 … 4:3 (round 4:
 * 3:4 … 5:4 made almost every phone photo the same 3:4 tile, so the waterfall
 * read as a grid). The cover editor uses the same frame so what you pick is
 * exactly what the card shows.
 */
export function homeCoverAspect(width: number | undefined, height: number | undefined): number {
  const ratio = Math.max(1, width ?? 1) / Math.max(1, height ?? 1);
  return Math.max(2 / 3, Math.min(4 / 3, ratio));
}

/**
 * Position a `cover`-filled image inside a frame. `focus` (0–1 of the photo) is
 * the point the user picked; it sits at the frame's centre as far as the photo
 * allows. Centre semantics (round 4) keep the same subject in view whatever the
 * frame shape — 方格 square, 瀑布 tile, list thumbnail — so the editor's square
 * window is what every cover shows (taller frames show a little more around it).
 */
export function focusedCoverRect(source: { width: number; height: number }, frame: { width: number; height: number }, focus: { x?: number; y?: number }) {
  const scale = Math.max(frame.width / Math.max(1, source.width), frame.height / Math.max(1, source.height));
  const width = source.width * scale;
  const height = source.height * scale;
  const clamp = (value: number | undefined) => Math.max(0, Math.min(1, value ?? 0.5));
  const offset = (size: number, frameSize: number, point: number) => Math.max(0, Math.min(size - frameSize, point * size - frameSize / 2));
  return { left: -offset(width, frame.width, clamp(focus.x)), top: -offset(height, frame.height, clamp(focus.y)), width, height };
}
