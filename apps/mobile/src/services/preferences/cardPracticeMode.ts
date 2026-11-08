import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

// How tapping a blank works by default: pick from options ("选择", the default)
// or type the answer ("填空"). Chosen in the card ⋯ menu, remembered globally.
export type CardPracticeMode = "choice" | "keyboard";

const STORAGE_KEY = "oio.cardPracticeMode.v1";
let current: CardPracticeMode = "choice";
let loaded = false;
const listeners = new Set<(mode: CardPracticeMode) => void>();

function load() {
  if (loaded) return;
  loaded = true;
  void AsyncStorage.getItem(STORAGE_KEY).then((value) => {
    if (value === "choice" || value === "keyboard") {
      current = value;
      for (const listener of listeners) listener(current);
    }
  }).catch(() => undefined);
}

export function getCardPracticeMode(): CardPracticeMode {
  load();
  return current;
}

export function setCardPracticeMode(mode: CardPracticeMode): void {
  current = mode;
  for (const listener of listeners) listener(mode);
  void AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => undefined);
}

export function useCardPracticeMode(): CardPracticeMode {
  const [mode, setMode] = useState(getCardPracticeMode);
  useEffect(() => {
    listeners.add(setMode);
    return () => { listeners.delete(setMode); };
  }, []);
  return mode;
}
