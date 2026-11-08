/**
 * Scattered "collage" placement for up to six blind-box cards on one page:
 * two columns, three rows, each card slightly turned like photos tossed on a
 * table. Deterministic per slot so cards do not jump between renders.
 */
const TILT = [-4, 3, 2.5, -3, -2, 4];
const NUDGE_X = [-4, 5, 6, -5, -3, 4];
const NUDGE_Y = [0, 10, -6, 6, 4, -4];

export function memoryCollageLayout(viewportWidth: number, viewportHeight: number, slot: number) {
  const columns = 2;
  const rows = 3;
  const gap = 14;
  const width = (viewportWidth - gap * 3) / columns;
  const height = (viewportHeight - gap * (rows + 1)) / rows;
  const column = slot % columns;
  const row = Math.floor(slot / columns);
  return {
    width,
    height,
    left: gap + column * (width + gap) + (NUDGE_X[slot] ?? 0),
    top: gap + row * (height + gap) + (NUDGE_Y[slot] ?? 0),
    rotate: TILT[slot] ?? 0,
  };
}
