import * as MediaLibrary from "expo-media-library/legacy";
import { memoryPhotoAccess, photoDayRange } from "./memoryPhotoPolicy";

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
  const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false });
  return info.id === asset.id;
}

export async function readMemoryPhotoPage(input: { after?: string; day?: Date } = {}) {
  const permission = await inspectMemoryPhotoPermission();
  if (permission.access !== "all" && permission.access !== "limited") {
    return { ...permission, assets: [] as MediaLibrary.Asset[], hasNextPage: false, endCursor: undefined };
  }
  const range = input.day ? photoDayRange(input.day) : undefined;
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
