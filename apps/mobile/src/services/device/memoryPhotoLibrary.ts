import * as ImageManipulator from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library/legacy";
import { Image, Platform } from "react-native";
import { androidPhotoDayPage, memoryPhotoAccess, memoryPhotoPreviewResize, photoDayRange } from "./memoryPhotoPolicy";
import { resolveMemoryPhotoSource } from "./memoryPhotoSource";

export function readMemoryPhotoSource(asset: MediaLibrary.Asset, allowNetwork = false) {
  return resolveMemoryPhotoSource(asset, Platform.OS, allowNetwork, {
    contentUri: MediaLibrary.getAssetContentUriAsync,
    info: MediaLibrary.getAssetInfoAsync,
  });
}

type MemoryPhotoPreviewSource = { id: string; uri: string; width: number; height: number };
const iosPreviewCache = new Map<string, Promise<MemoryPhotoPreviewSource>>();
const IOS_PREVIEW_CACHE_LIMIT = 60;
let iosPreviewQueue: Promise<unknown> = Promise.resolve();

/**
 * Pixels for showing a library photo on screen.
 *
 * iOS: the asset's own file path is often missing (iCloud "Optimize Storage")
 * or not readable by the app, which left previews gray. PhotoKit (through
 * ImageManipulator, which accepts ph:// and may fetch from iCloud) renders a
 * bounded JPEG into the app cache instead. One decode at a time: PhotoKit
 * decodes the original first, so a grid must not decode many at once.
 */
export function readMemoryPhotoPreview(asset: MediaLibrary.Asset): Promise<MemoryPhotoPreviewSource> {
  if (Platform.OS === "android") return readMemoryPhotoSource(asset);
  const cached = iosPreviewCache.get(asset.id);
  if (cached) return cached;
  const task = iosPreviewQueue.then(async () => {
    const resize = memoryPhotoPreviewResize(asset.width, asset.height);
    const result = await ImageManipulator.manipulateAsync(asset.uri, resize ? [{ resize }] : [], {
      compress: 0.82,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { id: asset.id, uri: result.uri, width: result.width, height: result.height };
  });
  iosPreviewQueue = task.catch(() => undefined);
  const cachedTask = task.catch((error) => {
    iosPreviewCache.delete(asset.id);
    throw error;
  });
  iosPreviewCache.set(asset.id, cachedTask);
  if (iosPreviewCache.size > IOS_PREVIEW_CACHE_LIMIT) {
    const oldest = iosPreviewCache.keys().next().value;
    if (oldest !== undefined) iosPreviewCache.delete(oldest);
  }
  return cachedTask;
}

// This module only reads the user's library. Upload/generation belongs to the
// separately confirmed card-creation action, never to browsing or pagination.
export async function inspectMemoryPhotoPermission() {
  const permission = await MediaLibrary.getPermissionsAsync(false, ["photo"]);
  return { access: memoryPhotoAccess(permission), canAskAgain: permission.canAskAgain };
}

/** Call only after the user enters the photo feature and accepts its explanation. */
export async function requestMemoryPhotoPermission() {
  const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
  return { access: memoryPhotoAccess(permission), canAskAgain: permission.canAskAgain };
}

/** Recheck the selected asset after confirmation; do not download cloud originals here. */
export async function canReadMemoryPhoto(asset: MediaLibrary.Asset) {
  const permission = await inspectMemoryPhotoPermission();
  if (permission.access !== "all" && permission.access !== "limited") return false;
  if (Platform.OS !== "android") {
    const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false });
    return info.id === asset.id;
  }
  const source = await readMemoryPhotoSource(asset);
  // Querying a row alone does not prove its bytes still exist or are readable.
  return new Promise<boolean>(resolve => Image.getSize(source.uri,
    (width, height) => resolve(width > 0 && height > 0), () => resolve(false)));
}

export async function readMemoryPhotoPage(input: { after?: string; day?: Date } = {}) {
  const permission = await inspectMemoryPhotoPermission();
  if (permission.access !== "all" && permission.access !== "limited") {
    return { ...permission, assets: [] as MediaLibrary.Asset[], hasNextPage: false, endCursor: undefined };
  }
  const range = input.day ? photoDayRange(input.day) : undefined;
  if (range && Platform.OS === "android") {
    // Files re-synced today can fill whole pages with older photos; read a
    // bounded number of pages so the first result is not empty for that reason.
    let after = input.after;
    for (let reads = 1; ; reads += 1) {
      const page = await MediaLibrary.getAssetsAsync({
        first: 60,
        after,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [[MediaLibrary.SortBy.modificationTime, false]],
      });
      const day = androidPhotoDayPage(page.assets, range);
      const hasNextPage = !day.passedDay && page.hasNextPage && Boolean(page.endCursor) && page.endCursor !== after;
      if (day.photos.length || !hasNextPage || reads >= 5) {
        return { ...permission, assets: day.photos, hasNextPage, endCursor: page.endCursor };
      }
      after = page.endCursor;
    }
  }
  const page = await MediaLibrary.getAssetsAsync({
    first: 60,
    after: input.after,
    mediaType: MediaLibrary.MediaType.photo,
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    // Native bounds differ at exact equality; include the boundary then apply
    // a half-open local-day filter without losing the underlying page cursor.
    ...(range ? { createdAfter: range.start - 1, createdBefore: range.end } : {}),
  });
  return {
    ...permission,
    assets: range ? page.assets.filter((asset) => asset.creationTime >= range.start && asset.creationTime < range.end) : page.assets,
    hasNextPage: page.hasNextPage && Boolean(page.endCursor) && page.endCursor !== input.after,
    endCursor: page.endCursor,
  };
}
