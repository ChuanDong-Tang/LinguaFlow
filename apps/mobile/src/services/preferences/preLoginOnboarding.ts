import AsyncStorage from "@react-native-async-storage/async-storage";
import { environmentStorageKey } from "../storage/environmentStorageKey";
import {
  accountOnboardingKey,
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

const STORAGE_KEY = environmentStorageKey("lf_account_onboarding_v1");
let writeQueue: Promise<void> = Promise.resolve();

export async function loadPreLoginOnboardingState(userId: string): Promise<PreLoginOnboardingState | null> {
  const raw = await AsyncStorage.getItem(accountOnboardingKey(STORAGE_KEY, userId));
  if (!raw) return null;
  try {
    return normalizePreLoginOnboardingState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function beginPreLoginOnboarding(userId: string, options?: { restart?: boolean }): Promise<PreLoginOnboardingState> {
  const existing = await loadPreLoginOnboardingState(userId);
  if (existing?.status === "in_progress" && !options?.restart) return existing;
  const state: PreLoginOnboardingState = {
    version: 1,
    status: "in_progress",
    step: 0,
    draft: {},
    pendingSync: false,
    completedAt: null,
  };
  await persist(userId, state);
  return state;
}

export async function savePreLoginOnboardingProgress(
  userId: string,
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
  await persist(userId, next);
  return next;
}

export async function completePreLoginOnboarding(
  userId: string,
  current: PreLoginOnboardingState,
): Promise<PreLoginOnboardingState> {
  if (!isCompletePreLoginOnboardingDraft(current.draft)) {
    throw new Error("Pre-login onboarding is incomplete");
  }
  const next: PreLoginOnboardingState = {
    ...current,
    status: "completed",
    step: 3,
    pendingSync: false,
    completedAt: new Date().toISOString(),
  };
  await persist(userId, next);
  return next;
}

async function persist(userId: string, state: PreLoginOnboardingState): Promise<void> {
  const serialized = JSON.stringify(state);
  const key = accountOnboardingKey(STORAGE_KEY, userId);
  writeQueue = writeQueue.catch(() => undefined).then(() => AsyncStorage.setItem(key, serialized));
  await writeQueue;
}
