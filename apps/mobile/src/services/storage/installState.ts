import AsyncStorage from "@react-native-async-storage/async-storage";
import { environmentStorageKey } from "./environmentStorageKey";

const INSTALL_STATE_KEY = environmentStorageKey("lf_local_install_state_v1");

export async function reconcileLocalInstallState(): Promise<{ isFreshInstall: boolean }> {
  const marker = await AsyncStorage.getItem(INSTALL_STATE_KEY);
  if (marker) return { isFreshInstall: false };

  const keys = await AsyncStorage.getAllKeys();
  const hasLocalEvidence = keys.some((key) => key !== INSTALL_STATE_KEY);
  await AsyncStorage.setItem(INSTALL_STATE_KEY, new Date().toISOString());
  return { isFreshInstall: !hasLocalEvidence };
}
