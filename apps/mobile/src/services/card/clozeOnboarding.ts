import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSession } from "../auth/authStorage";
import { environmentStorageKey } from "../storage/environmentStorageKey";

const COMPLETED_KEY_PREFIX = "linguaflow.card_detail.cloze_onboarding.completed.v3";
const CANDIDATE_KEY_PREFIX = "linguaflow.card_detail.cloze_onboarding.candidate.v3";

type ClozeOnboardingKeys = {
  completed: string;
  candidate: string;
};

async function getKeys(): Promise<ClozeOnboardingKeys | null> {
  const session = await getSession();
  if (!session?.user.id) return null;
  return {
    completed: environmentStorageKey(`${COMPLETED_KEY_PREFIX}:${session.user.id}`),
    candidate: environmentStorageKey(`${CANDIDATE_KEY_PREFIX}:${session.user.id}`),
  };
}

/** Remember the first newly created Card until its generated content is ready. */
export async function registerClozeOnboardingCandidate(recordId: string): Promise<void> {
  const keys = await getKeys();
  if (!keys) return;
  const [completed, candidate] = await AsyncStorage.multiGet([keys.completed, keys.candidate]);
  if (completed[1] || candidate[1]) return;
  await AsyncStorage.setItem(keys.candidate, recordId);
}

/** Any Card entry point can resolve whether this is the pending first-Card guide. */
export async function shouldShowClozeOnboarding(recordId: string): Promise<boolean> {
  const keys = await getKeys();
  if (!keys) return false;
  const [completed, candidate] = await AsyncStorage.multiGet([keys.completed, keys.candidate]);
  return !completed[1] && candidate[1] === recordId;
}

export async function completeClozeOnboarding(recordId: string): Promise<void> {
  const keys = await getKeys();
  if (!keys) return;
  const candidate = await AsyncStorage.getItem(keys.candidate);
  if (candidate !== recordId) return;
  await AsyncStorage.multiSet([[keys.completed, "1"], [keys.candidate, ""]]);
  await AsyncStorage.removeItem(keys.candidate);
}
