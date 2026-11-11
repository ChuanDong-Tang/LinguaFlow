import AsyncStorage from "@react-native-async-storage/async-storage";
import type * as MediaLibrary from "expo-media-library/legacy";

// Where the photo flow was left (2026-11 feedback): reopening continues there.
// 近期 remembers the photo; 盲盒 remembers its dealt set and position.
const KEY = { recent: "oio.photoFlow.recent.v1", random: "oio.photoFlow.random.v1" } as const;

export type SavedPhotoFlow =
  | { mode: "recent"; assetId: string }
  | { mode: "random"; deck: MediaLibrary.Asset[]; index: number };

export async function loadPhotoFlowPosition(mode: "recent" | "random"): Promise<SavedPhotoFlow | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY[mode]);
    if (!raw) return null;
    const value = JSON.parse(raw) as SavedPhotoFlow;
    if (value.mode === "recent" && typeof value.assetId === "string") return value;
    if (value.mode === "random" && Array.isArray(value.deck) && value.deck.length && Number.isInteger(value.index)) return value;
    return null;
  } catch { return null; }
}

export function savePhotoFlowPosition(value: SavedPhotoFlow): void {
  void AsyncStorage.setItem(KEY[value.mode], JSON.stringify(value)).catch(() => undefined);
}
