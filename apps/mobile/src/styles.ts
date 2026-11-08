import type { StyleSheet } from "react-native";

// Style sheets that can be regenerated when the appearance changes.
// Use `createStyles(() => ({ ... }))` instead of `StyleSheet.create({ ... })`
// whenever the sheet reads `theme`. On a switch, every registered sheet is
// rebuilt in place; the app then remounts its views so native props refresh.

type AnySheet = Record<string, Record<string, unknown>>;
const registry: Array<{ factory: () => unknown; sheet: AnySheet }> = [];

export function createStyles<T extends StyleSheet.NamedStyles<T>>(factory: () => T & StyleSheet.NamedStyles<T>): T {
  const sheet = factory();
  registry.push({ factory, sheet: sheet as unknown as AnySheet });
  return sheet;
}

export function regenerateStyles() {
  for (const entry of registry) {
    const next = entry.factory() as AnySheet;
    for (const key of Object.keys(next)) {
      const current = entry.sheet[key];
      if (current && typeof current === "object" && !Object.isFrozen(current)) {
        for (const prop of Object.keys(current)) delete current[prop];
        Object.assign(current, next[key]);
      } else {
        entry.sheet[key] = next[key];
      }
    }
  }
}
