import AsyncStorage from "@react-native-async-storage/async-storage";

export const GUIDE_INITIAL_UI_LOCALE = "initial_ui_locale_v1";
export const GUIDE_FIRST_LEARNING_SETUP = "first_learning_setup_v1";
export const GUIDE_LEARNING_FLOW_HELP = "learning_flow_help_v1";

const GUIDE_STATE_KEY = "linguaflow.guide.flags.v1";

export type GuideState = Record<string, { completedAt?: string }>;

export async function loadLocalGuideState(): Promise<GuideState> {
  const raw = await AsyncStorage.getItem(GUIDE_STATE_KEY);
  if (!raw) return {};
  try {
    return normalizeGuideState(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function saveLocalGuideState(state: GuideState): Promise<void> {
  await AsyncStorage.setItem(GUIDE_STATE_KEY, JSON.stringify(normalizeGuideState(state)));
}

export async function markLocalGuideCompleted(key: string): Promise<GuideState> {
  const next = {
    ...(await loadLocalGuideState()),
    [key]: { completedAt: new Date().toISOString() },
  };
  await saveLocalGuideState(next);
  return next;
}

export function isGuideCompleted(state: GuideState | null | undefined, key: string): boolean {
  return Boolean(state?.[key]?.completedAt);
}

export function mergeGuideState(local: GuideState, remote: GuideState | null | undefined): GuideState {
  const output = { ...local };
  for (const [key, entry] of Object.entries(remote ?? {})) {
    const localTime = Date.parse(output[key]?.completedAt ?? "");
    const remoteTime = Date.parse(entry.completedAt ?? "");
    if (!output[key] || remoteTime >= localTime) {
      output[key] = entry;
    }
  }
  return output;
}

export function completeGuide(state: GuideState, key: string): GuideState {
  return {
    ...state,
    [key]: { completedAt: new Date().toISOString() },
  };
}

function normalizeGuideState(value: unknown): GuideState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: GuideState = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const completedAt = (entry as Record<string, unknown>).completedAt;
    output[key] = typeof completedAt === "string" ? { completedAt } : {};
  }
  return output;
}
