import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { BLIND_BOX_TONES, DEFAULT_BLIND_BOX_TONES, type BlindBoxTone } from "../../domain/blindBox/pickSentence";

/**
 * 盲盒设置 (2026-11 round 4): the set size and which blanks a sentence must hold
 * (未填 / 填错 / 填对, multi-select). Kept on the device; read synchronously by
 * the game so the card detail needs no extra plumbing.
 */
export type BlindBoxSettings = { setSize: number; tones: readonly BlindBoxTone[] };

export const BLIND_BOX_SET_SIZES = [15, 20, 30, 50, 100] as const;
const KEY = "oio.blindBox.settings.v1";
const DEFAULTS: BlindBoxSettings = { setSize: 15, tones: DEFAULT_BLIND_BOX_TONES };

let current: BlindBoxSettings = DEFAULTS;
let loaded: Promise<void> | null = null;
const listeners = new Set<(settings: BlindBoxSettings) => void>();

function sanitize(raw: unknown): BlindBoxSettings {
  const value = (raw ?? {}) as Partial<BlindBoxSettings>;
  const setSize = BLIND_BOX_SET_SIZES.includes(value.setSize as (typeof BLIND_BOX_SET_SIZES)[number]) ? value.setSize! : DEFAULTS.setSize;
  const tones = Array.isArray(value.tones) ? BLIND_BOX_TONES.filter((tone) => value.tones!.includes(tone)) : [];
  return { setSize, tones: tones.length ? tones : DEFAULTS.tones };
}

export function loadBlindBoxSettings(): Promise<void> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((raw) => { if (raw) { current = sanitize(JSON.parse(raw)); listeners.forEach((listener) => listener(current)); } })
    .catch(() => undefined);
  return loaded;
}

export function getBlindBoxSettings(): BlindBoxSettings {
  return current;
}

export function setBlindBoxSettings(next: Partial<BlindBoxSettings>): void {
  current = sanitize({ ...current, ...next });
  listeners.forEach((listener) => listener(current));
  void AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => undefined);
}

export function useBlindBoxSettings(): BlindBoxSettings {
  const [settings, setSettings] = useState(current);
  useEffect(() => {
    listeners.add(setSettings);
    void loadBlindBoxSettings();
    setSettings(current);
    return () => { listeners.delete(setSettings); };
  }, []);
  return settings;
}
