import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  AvatarModerationRejectedError,
  AvatarValidationError,
  UserAvatarService,
} from "./UserAvatarService.js";

test("avatar upload validates declared size before creating COS authorization", async () => {
  const service = new UserAvatarService({} as never, {} as never);
  await assert.rejects(
    service.createUpload({ userId: "user-1", fileSize: 0, width: 512, height: 512 }),
    AvatarValidationError,
  );
});

test("avatar IMS Review keeps the current avatar and does not derive assets", async () => {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#ffffff" },
  }).jpeg().toBuffer();
  let activated = false;
  let uploaded = false;
  const repository = {
    findAvatarAsset: async () => ({
      id: "upload-1", userId: "user-1", status: "uploading",
      originalObjectKey: "isolated/original.jpg", profileObjectKey: null, thumbnailObjectKey: null,
      mimeType: "image/jpeg", fileSize: bytes.length, width: 2, height: 2,
      expiresAt: new Date(Date.now() + 60_000),
    }),
    markAvatarFailed: async () => undefined,
    activateAvatar: async () => { activated = true; throw new Error("unexpected activation"); },
  };
  const storage = {
    download: async () => bytes,
    getSignedUrl: async () => ({ url: "https://signed.invalid/image", expiresAt: new Date() }),
    upload: async () => { uploaded = true; },
  };
  const ims = {
    moderateImage: async () => ({ requestId: "ims-1", suggestion: "Review", label: "Normal" }),
  };
  const service = new UserAvatarService(repository as never, storage as never, ims as never);
  await assert.rejects(service.complete("user-1", "upload-1"), AvatarModerationRejectedError);
  assert.equal(activated, false);
  assert.equal(uploaded, false);
});
