import { Directory, File, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import {
  completeCardImageUpload,
  createCardImageUpload,
  getCardImageUpload,
  CardApiError,
} from "../api/cardApi";
import type { CardDraft } from "./cardDraftStorage";

export async function prepareCardDraftImage(input: { uri: string; width: number; height: number }): Promise<NonNullable<CardDraft["image"]>> {
  const normalized = await ImageManipulator.manipulateAsync(
    input.uri,
    [],
    { compress: 0.94, format: ImageManipulator.SaveFormat.JPEG },
  );
  const targetRatio = normalized.width >= normalized.height ? 3 / 2 : 4 / 5;
  const currentRatio = normalized.width / normalized.height;
  const cropWidth = currentRatio > targetRatio ? Math.round(normalized.height * targetRatio) : normalized.width;
  const cropHeight = currentRatio > targetRatio ? normalized.height : Math.round(normalized.width / targetRatio);
  const longEdge = Math.max(cropWidth, cropHeight);
  const scale = longEdge > 2048 ? 2048 / longEdge : 1;
  const manipulated = await ImageManipulator.manipulateAsync(
    normalized.uri,
    [
      { crop: {
        originX: Math.max(0, Math.floor((normalized.width - cropWidth) / 2)),
        originY: Math.max(0, Math.floor((normalized.height - cropHeight) / 2)),
        width: cropWidth,
        height: cropHeight,
      } },
      ...(scale < 1 ? [{ resize: { width: Math.round(cropWidth * scale), height: Math.round(cropHeight * scale) } } as const] : []),
    ],
    { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG },
  );
  const directory = new Directory(Paths.document, "card-drafts");
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(directory, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  new File(manipulated.uri).copy(destination);
  try {
    const normalizedFile = new File(normalized.uri);
    if (normalizedFile.exists) normalizedFile.delete();
    const manipulatedFile = new File(manipulated.uri);
    if (manipulatedFile.exists) manipulatedFile.delete();
  } catch { /* temporary cache cleanup is best effort */ }
  return {
    localUri: destination.uri,
    uploadId: null,
    status: "pending",
    width: manipulated.width,
    height: manipulated.height,
    fileSize: destination.size,
    mimeType: "image/jpeg",
  };
}

export async function uploadCardDraftImage(
  image: NonNullable<CardDraft["image"]>,
  onState: (image: NonNullable<CardDraft["image"]>) => void,
): Promise<NonNullable<CardDraft["image"]>> {
  if (image.uploadId) {
    try {
      const remote = await getCardImageUpload(image.uploadId);
      if (remote.status === "approved" || remote.status === "approved_with_review") return { ...image, status: "ready" };
    } catch (error) {
      if (!(error instanceof CardApiError) || error.status !== 404) throw error;
    }
  }
  let current: NonNullable<CardDraft["image"]> = { ...image, status: "uploading" };
  onState(current);
  const session = await createCardImageUpload({ mimeType: image.mimeType, fileSize: image.fileSize, width: image.width, height: image.height });
  current = { ...current, uploadId: session.uploadId };
  onState(current);
  const response = await fetch(session.uploadUrl, {
    method: "PUT",
    headers: session.headers,
    body: await (await fetch(image.localUri)).blob(),
  });
  if (!response.ok) throw new Error(`图片上传失败 (${response.status})`);
  current = { ...current, status: "moderating" };
  onState(current);
  const completed = await completeCardImageUpload(session.uploadId);
  if (completed.status !== "approved" && completed.status !== "approved_with_review") {
    throw new Error(completed.status === "rejected" ? "图片未通过审核" : "图片暂时无法审核");
  }
  return { ...current, status: "ready" };
}

export function removePersistentDraftImage(uri: string): void {
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* best effort */ }
}
