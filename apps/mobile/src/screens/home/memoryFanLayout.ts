/** Leave room for the rotated side cards inside the horizontal paging viewport. */
export function memoryFanLayout(viewportWidth: number, desiredHeight: number) {
  const width = Math.max(0, viewportWidth);
  return { width: width * .58, height: Math.max(0, Math.min(desiredHeight, width * 1.05)), offset: width * .12, angle: 8 };
}
