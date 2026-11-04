import { memoryPhotoPreviewUri } from "./memoryPhotoPolicy";

type Photo = { id: string; uri: string; width: number; height: number };
type PhotoInfo = Photo & { localUri?: string | null };

/** Android needs readable pixels, never the full EXIF/location query. */
export async function resolveMemoryPhotoSource<T extends Photo>(asset: T, platform: string, allowNetwork: boolean, readers: {
  contentUri: (asset: T) => Promise<string>;
  info: (asset: T, options: { shouldDownloadFromNetwork: boolean }) => Promise<PhotoInfo>;
}): Promise<Photo> {
  if (platform === "android") {
    const uri = await readers.contentUri(asset);
    if (!/^content:\/\//i.test(uri)) throw new Error("Photo content URI unavailable");
    return { id: asset.id, uri, width: asset.width, height: asset.height };
  }
  const info = await readers.info(asset, { shouldDownloadFromNetwork: allowNetwork });
  const uri = memoryPhotoPreviewUri(info);
  if (info.id !== asset.id || !uri) throw new Error("Photo is not locally accessible");
  return { id: info.id, uri, width: info.width, height: info.height };
}
