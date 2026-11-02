export const FONT_SIZES = ["small", "medium", "large"] as const;
export type FontSize = typeof FONT_SIZES[number];
export const FONT_SCALES: Record<FontSize, number> = { small: 0.9, medium: 1, large: 1.15 };
export const FONT_SIZE_KEY = "oio.device.font-size.v1";
export function normalizeFontSize(value: unknown): FontSize {
  return value === "small" || value === "large" ? value : "medium";
}

export function createFontSizeStore(storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }) {
  let current: FontSize = "medium";
  let saved: FontSize = "medium";
  let revision = 0;
  let hydration: Promise<void> | undefined;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (value: FontSize) => { current = value; listeners.forEach(fn => fn()); };
  return {
    getSnapshot: () => current,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    load() {
      if (!hydration) {
        const start = revision;
        hydration = storage.getItem(FONT_SIZE_KEY).then(value => {
          if (revision === start) { saved = normalizeFontSize(value); publish(saved); }
        }).catch(() => undefined);
      }
      return hydration;
    },
    set(value: FontSize) {
      const next = normalizeFontSize(value);
      const ownRevision = ++revision;
      publish(next);
      const result = queue.catch(() => undefined).then(async () => {
        try { await storage.setItem(FONT_SIZE_KEY, next); saved = next; }
        catch (error) { if (revision === ownRevision) publish(saved); throw error; }
      });
      queue = result;
      return result;
    },
  };
}

/** Only explicit nested metrics are scaled: inherited text is already scaled. */
export function scaledFontMetrics(style: { fontSize?: number; lineHeight?: number; letterSpacing?: number }, scale: number, nested = false) {
  if (scale === 1) return {};
  return {
    ...(typeof style.fontSize === "number" ? { fontSize: style.fontSize * scale } : !nested ? { fontSize: 14 * scale } : {}),
    ...(typeof style.lineHeight === "number" ? { lineHeight: style.lineHeight * scale } : {}),
    ...(typeof style.letterSpacing === "number" ? { letterSpacing: style.letterSpacing * scale } : {}),
  };
}
