import assert from "node:assert/strict";
import test from "node:test";
import { CardImageNotReadyError, CardService } from "./CardService.js";

test("a direct card whose image upload can no longer be claimed fails as CardImageNotReadyError, not a raw 500", async () => {
  const repository = {
    findByUserClientId: async () => null,
    createDirect: async () => { throw new Error("CARD_IMAGE_NOT_READY"); },
  };
  const preferences = {
    getByUserId: async () => ({ learningLanguage: "en", appLocale: "zh-CN", promptDifficulty: "natural" }),
  };
  const service = new CardService(repository as never, preferences as never, {} as never, {} as never, 60_000);
  await assert.rejects(
    service.create({
      userId: "user-1",
      requestId: "req-1",
      body: { clientId: "client-1", originalText: "今天下雨了", generateRewrite: false, imageUploadIds: ["expired-upload"] },
    }),
    (error: unknown) => error instanceof CardImageNotReadyError && error.code === "CARD_IMAGE_NOT_READY",
  );
});
