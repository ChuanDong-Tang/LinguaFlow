import { Directory, File, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import {
  completeCardImageUpload,
  createCardImageUpload,
  getCardImageUpload,
  CardApiError,
} from "../api/cardApi";
import type { CardDraftImage } from "./cardDraftStorage";
import { fetchWithTimeout } from "../api/fetchWithTimeout";
import { copyAndMeasureCardImage, requireCardImageFileSize } from "./cardImageFile";

export class CardImageModerationRejectedError extends Error {
  constructor() {
    super("CARD_IMAGE_MODERATION_REJECTED");
    this.name = "CardImageModerationRejectedError";
  }
}

export async function prepareCardDraftImage(input: { uri: string; width: number; height: number }): Promise<CardDraftImage> {
  const normalized = await ImageManipulator.manipulateAsync(
    input.uri,
    [],
    { compress: 0.94, format: ImageManipulator.SaveFormat.JPEG },
  );
  // Keep the complete source for full-screen viewing and image understanding.
  // Card thumbnails apply their own non-destructive cover crop on the server.
  const longEdge = Math.max(normalized.width, normalized.height);
  const scale = longEdge > 2048 ? 2048 / longEdge : 1;
  const manipulated = await ImageManipulator.manipulateAsync(
    normalized.uri,
    scale < 1 ? [{ resize: { width: Math.round(normalized.width * scale), height: Math.round(normalized.height * scale) } }] : [],
    { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG },
  );
  const directory = new Directory(Paths.document, "card-drafts");
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(directory, `draft-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  let fileSize: number;
  try {
    fileSize = await copyAndMeasureCardImage(
      new File(manipulated.uri),
      destination,
      () => new File(destination.uri).size,
    );
  } finally {
    try {
      const normalizedFile = new File(normalized.uri);
      if (normalizedFile.exists) normalizedFile.delete();
      const manipulatedFile = new File(manipulated.uri);
      if (manipulatedFile.exists) manipulatedFile.delete();
    } catch { /* temporary cache cleanup is best effort */ }
  }
  return {
    localUri: destination.uri,
    uploadId: null,
    status: "pending",
    width: manipulated.width,
    height: manipulated.height,
    fileSize,
    mimeType: "image/jpeg",
  };
}

export async function uploadCardDraftImage(
  image: CardDraftImage,
  onState: (image: CardDraftImage) => void,
): Promise<CardDraftImage> {
  if (image.uploadId) {
    try {
      const remote = await getCardImageUpload(image.uploadId);
      if (remote.status === "approved" || remote.status === "approved_with_review") return { ...image, status: "ready" };
    } catch (error) {
      if (!(error instanceof CardApiError) || error.status !== 404) throw error;
    }
  }
  let current: CardDraftImage = { ...image, status: "uploading" };
  onState(current);
  // Stored drafts from an interrupted/older build can contain stale metadata.
  // Read the exact bytes first and use their size for both the upload session
  // and the PUT body so the server validates the same payload we send.
  const localResponse = await fetchWithTimeout(image.localUri);
  const imageBlob = await localResponse.blob();
  const fileSize = requireCardImageFileSize(imageBlob.size);
  current = { ...current, fileSize };
  onState(current);
  const session = await createCardImageUpload({ mimeType: image.mimeType, fileSize, width: image.width, height: image.height });
  current = { ...current, uploadId: session.uploadId };
  onState(current);
  try {
    const response = await fetchWithTimeout(session.uploadUrl, {
      method: "PUT",
      headers: session.headers,
      body: imageBlob,
    });
    if (!response.ok) throw new Error(`图片上传失败 (${response.status})`);
    current = { ...current, status: "moderating" };
    onState(current);
    const completed = await completeCardImageUpload(session.uploadId);
    if (completed.status !== "approved" && completed.status !== "approved_with_review") {
      if (completed.status === "rejected") throw new CardImageModerationRejectedError();
      throw new Error("图片暂时无法审核");
    }
    return { ...current, status: "ready" };
  } catch (error) {
    // The upload/complete response can be lost after the server has already
    // approved the asset. Reconcile once before showing a false failure.
    try {
      const remote = await getCardImageUpload(session.uploadId);
      if (remote.status === "approved" || remote.status === "approved_with_review") {
        return { ...current, status: "ready" };
      }
      if (remote.status === "rejected") throw new CardImageModerationRejectedError();
    } catch (reconcileError) {
      if (reconcileError instanceof CardImageModerationRejectedError) throw reconcileError;
    }
    throw error;
  }
}

export function removePersistentDraftImage(uri: string): void {
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* best effort */ }
}
