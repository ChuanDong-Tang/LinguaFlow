import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSession } from "../auth/authStorage";
import { environmentStorageKey } from "../storage/environmentStorageKey";
import type { CardGenerationTarget } from "./cardContentGeneration";

export type CardGenerationState = {
  pendingTargets: CardGenerationTarget[];
  failedTargets: CardGenerationTarget[];
};

const VALID_TARGETS = new Set<CardGenerationTarget>(["expression", "translation", "auxiliary", "reply"]);
let queue: Promise<void> = Promise.resolve();
const activeRecordIds = new Set<string>();
const listeners = new Set<(recordId: string, state: CardGenerationState | null) => void>();

export function isCardGenerationInProgress(excludingRecordId?: string): boolean {
  return [...activeRecordIds].some((recordId) => recordId !== excludingRecordId);
}

export function isCardRecordGenerationInProgress(recordId: string): boolean {
  return activeRecordIds.has(recordId);
}

export function subscribeCardGenerationState(listener: (recordId: string, state: CardGenerationState | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function key(): Promise<string | null> {
  const session = await getSession();
  return session?.user.id ? environmentStorageKey(`lf_card_generation_state_v1:${session.user.id}`) : null;
}

async function readAll(): Promise<Record<string, CardGenerationState>> {
  const storageKey = await key();
  if (!storageKey) return {};
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(storageKey)) ?? "{}") as Record<string, Partial<CardGenerationState>>;
    return Object.fromEntries(Object.entries(parsed).map(([recordId, value]) => [recordId, {
      pendingTargets: normalizeTargets(value.pendingTargets),
      failedTargets: normalizeTargets(value.failedTargets),
    }]));
  } catch {
    return {};
  }
}

export async function getCardGenerationState(recordId: string): Promise<CardGenerationState | null> {
  const state = (await readAll())[recordId];
  if (!state || (!state.pendingTargets.length && !state.failedTargets.length)) return null;

  // A pending request cannot survive a terminated JS runtime. The server may
  // still have committed the current target, which the detail reload will
  // reconcile. Any remaining targets must become retryable instead of showing
  // an endless loading state after a cold start.
  if (state.pendingTargets.length && !activeRecordIds.has(recordId)) {
    const recovered: CardGenerationState = {
      pendingTargets: [],
      failedTargets: normalizeTargets([...state.failedTargets, ...state.pendingTargets]),
    };
    await setCardGenerationState(recordId, recovered);
    return recovered;
  }

  return state;
}

export async function setCardGenerationState(recordId: string, state: CardGenerationState | null): Promise<void> {
  if (state?.pendingTargets.length) activeRecordIds.add(recordId);
  else activeRecordIds.delete(recordId);
  listeners.forEach((listener) => listener(recordId, state));
  queue = queue.catch(() => undefined).then(async () => {
    const storageKey = await key();
    if (!storageKey) return;
    const all = await readAll();
    if (!state || (!state.pendingTargets.length && !state.failedTargets.length)) delete all[recordId];
    else all[recordId] = { pendingTargets: normalizeTargets(state.pendingTargets), failedTargets: normalizeTargets(state.failedTargets) };
    await AsyncStorage.setItem(storageKey, JSON.stringify(all));
  });
  await queue;
}

function normalizeTargets(value: unknown): CardGenerationTarget[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((target): target is CardGenerationTarget => typeof target === "string" && VALID_TARGETS.has(target as CardGenerationTarget)))]
    : [];
}
