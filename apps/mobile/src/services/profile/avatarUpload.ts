import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { completeAvatarUpload, createAvatarUpload, type UserProfile } from "../api/meApi";
import { fetchWithTimeout } from "../api/fetchWithTimeout";

export async function prepareAndUploadAvatar(input: { uri: string }): Promise<UserProfile> {
  const normalized = await ImageManipulator.manipulateAsync(
    input.uri,
    [],
    { compress: 0.94, format: ImageManipulator.SaveFormat.JPEG },
  );
  const edge = Math.min(normalized.width, normalized.height);
  const cropped = await ImageManipulator.manipulateAsync(
    normalized.uri,
    [
      { crop: {
        originX: Math.max(0, Math.floor((normalized.width - edge) / 2)),
        originY: Math.max(0, Math.floor((normalized.height - edge) / 2)),
        width: edge,
        height: edge,
      } },
      { resize: { width: 1024, height: 1024 } },
    ],
    { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG },
  );
  const file = new File(cropped.uri);
  try {
    const session = await createAvatarUpload({
      fileSize: file.size,
      width: cropped.width,
      height: cropped.height,
    });
    const response = await fetchWithTimeout(session.uploadUrl, {
      method: "PUT",
      headers: session.headers,
      body: await (await fetchWithTimeout(cropped.uri)).blob(),
    });
    if (!response.ok) throw new Error(`头像上传失败 (${response.status})`);
    return await completeAvatarUpload(session.uploadId);
  } finally {
    try { if (file.exists) file.delete(); } catch { /* cache cleanup is best effort */ }
    try {
      const normalizedFile = new File(normalized.uri);
      if (normalizedFile.exists) normalizedFile.delete();
    } catch { /* cache cleanup is best effort */ }
  }
}
