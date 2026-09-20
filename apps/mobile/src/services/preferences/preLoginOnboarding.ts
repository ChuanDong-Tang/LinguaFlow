import AsyncStorage from "@react-native-async-storage/async-storage";
import { environmentStorageKey } from "../storage/environmentStorageKey";
import {
  isCompletePreLoginOnboardingDraft,
  normalizePreLoginOnboardingState,
  resolvePreLoginOnboardingLaunch,
  type PreLoginOnboardingDraft,
  type PreLoginOnboardingState,
  type PreLoginOnboardingStep,
} from "./preLoginOnboardingState";

export {
  isCompletePreLoginOnboardingDraft,
  normalizePreLoginOnboardingState,
  resolvePreLoginOnboardingLaunch,
  type PreLoginOnboardingDraft,
  type PreLoginOnboardingState,
  type PreLoginOnboardingStep,
} from "./preLoginOnboardingState";

const STORAGE_KEY = environmentStorageKey("lf_pre_login_onboarding_v1");
let writeQueue: Promise<void> = Promise.resolve();

export async function loadPreLoginOnboardingState(): Promise<PreLoginOnboardingState | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return normalizePreLoginOnboardingState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function beginPreLoginOnboarding(): Promise<PreLoginOnboardingState> {
  const existing = await loadPreLoginOnboardingState();
  if (existing) return existing;
  const state: PreLoginOnboardingState = {
    version: 1,
    status: "in_progress",
    step: 0,
    draft: {},
    pendingSync: false,
    completedAt: null,
  };
  await persist(state);
  return state;
}

export async function savePreLoginOnboardingProgress(
  current: PreLoginOnboardingState,
  input: { step?: PreLoginOnboardingStep; draft?: PreLoginOnboardingDraft },
): Promise<PreLoginOnboardingState> {
  const next: PreLoginOnboardingState = {
    ...current,
    status: "in_progress",
    step: input.step ?? current.step,
    draft: input.draft ?? current.draft,
    pendingSync: false,
    completedAt: null,
  };
  await persist(next);
  return next;
}

export async function completePreLoginOnboarding(
  current: PreLoginOnboardingState,
): Promise<PreLoginOnboardingState> {
  if (!isCompletePreLoginOnboardingDraft(current.draft)) {
    throw new Error("Pre-login onboarding is incomplete");
  }
  const next: PreLoginOnboardingState = {
    ...current,
    status: "completed",
    step: 3,
    pendingSync: true,
    completedAt: new Date().toISOString(),
  };
  await persist(next);
  return next;
}

export async function markPreLoginOnboardingSynced(): Promise<void> {
  const current = await loadPreLoginOnboardingState();
  if (!current || current.status !== "completed" || !current.pendingSync) return;
  await persist({ ...current, pendingSync: false });
}

async function persist(state: PreLoginOnboardingState): Promise<void> {
  const serialized = JSON.stringify(state);
  writeQueue = writeQueue.catch(() => undefined).then(() => AsyncStorage.setItem(STORAGE_KEY, serialized));
  await writeQueue;
}
