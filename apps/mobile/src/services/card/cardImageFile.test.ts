import assert from "node:assert/strict";
import test from "node:test";
import { copyAndMeasureCardImage, requireCardImageFileSize } from "./cardImageFile";

test("waits for the asynchronous file copy before reading Android file metadata", async () => {
  let copied = false;
  const size = await copyAndMeasureCardImage(
    {
      async copy() {
        await Promise.resolve();
        copied = true;
      },
    },
    {},
    () => copied ? 42 : 0,
  );

  assert.equal(size, 42);
});

test("rejects missing or empty image files before opening an upload session", () => {
  assert.throws(() => requireCardImageFileSize(null), /CARD_IMAGE_FILE_UNAVAILABLE/);
  assert.throws(() => requireCardImageFileSize(0), /CARD_IMAGE_FILE_UNAVAILABLE/);
  assert.equal(requireCardImageFileSize(128), 128);
});
