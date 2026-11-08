// The resolved appearance for this JS session. It is set once by
// `loadAppearance()` (index.ts) before the app — and therefore theme.ts — is
// evaluated. Changing the preference reloads the app (see preference.ts).
export type AppearancePreference = "light" | "dark" | "system";
export type ResolvedAppearance = "light" | "dark";

export const appearance: { preference: AppearancePreference; resolved: ResolvedAppearance } = {
  preference: "system",
  resolved: "light",
};
