import assert from "node:assert/strict";
import test from "node:test";

import type { CardRecordDetail } from "../api/cardApi";
import {
  coordinateMissingCardContent,
  type CardGenerationDependencies,
  type CardGenerationTarget,
} from "./cardContentGenerationCoordinator";

function detail(input: {
  rewrite?: boolean;
  auxiliary?: boolean;
  image?: boolean;
} = {}): CardRecordDetail {
  const rewriteBlock = input.rewrite ? [{
    contentType: "rewrite" as const,
    contentVersion: "rewrite-v1",
    text: "A natural rewrite.",
    languageCode: "en-US",
    segments: [],
    practice: null,
    ...(input.auxiliary ? {
      auxiliarySegments: [{ ordinal: 0, text: "自然的改写。" }],
      auxiliaryLanguageCode: "zh-CN",
    } : {}),
  }] : [];
  return {
    id: "card:parallel-test",
    rewrittenText: input.rewrite ? "A natural rewrite." : null,
    translationText: null,
    auxiliarySegments: input.auxiliary ? [{ ordinal: 0, text: "自然的改写。" }] : [],
    replyText: null,
    contentBlocks: [{
      contentType: "original",
      contentVersion: "original-v1",
      text: "今天完成了一件事。",
      languageCode: "zh-CN",
      segments: [],
      practice: null,
    }, ...rewriteBlock],
    images: [{
      id: "image-1",
      url: "https://example.test/image.png",
      width: 100,
      height: 100,
      focusX: 0.5,
      focusY: 0.5,
      descriptionStatus: input.image ? "completed" : "pending",
      descriptionText: input.image ? "A green circle." : null,
    }],
  } as unknown as CardRecordDetail;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("starts rewrite auxiliary before unrelated image generation finishes", async () => {
  const calls: string[] = [];
  const imageResult = deferred<CardRecordDetail>();
  const merged = detail({ rewrite: true, auxiliary: true, image: true });
  const dependencies: CardGenerationDependencies = {
    async generateContent(_id, target) {
      calls.push(target);
      if (target === "expression") return detail({ rewrite: true });
      if (target === "auxiliary") return detail({ rewrite: true, auxiliary: true });
      throw new Error(`Unexpected target: ${target}`);
    },
    async generateImageDescriptions() {
      calls.push("image_description");
      return imageResult.promise;
    },
    async getRecord() {
      calls.push("get_record");
      return merged;
    },
  };

  const generation = coordinateMissingCardContent(
    detail(),
    ["expression", "image_description", "auxiliary"],
    dependencies,
    rules,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.ok(calls.includes("image_description"));
  assert.ok(calls.includes("auxiliary"));
  assert.equal(calls.includes("get_record"), false);

  imageResult.resolve(detail({ image: true }));
  const result = await generation;
  assert.deepEqual(result.failedTargets, []);
  assert.deepEqual(result.generatedTargets, ["expression", "auxiliary", "image_description"]);
  assert.equal(result.detail, merged);
  assert.equal(calls.at(-1), "get_record");
});

test("keeps image success retryable when expression prevents dependent auxiliary", async () => {
  const calls: string[] = [];
  const merged = detail({ image: true });
  const dependencies: CardGenerationDependencies = {
    async generateContent(_id, target) {
      calls.push(target);
      throw new Error("EXPRESSION_FAILED");
    },
    async generateImageDescriptions() {
      calls.push("image_description");
      return detail({ image: true });
    },
    async getRecord() {
      return merged;
    },
  };

  const result = await coordinateMissingCardContent(
    detail(),
    ["expression", "image_description", "auxiliary"],
    dependencies,
    rules,
  );

  assert.deepEqual(calls, ["expression", "image_description"]);
  assert.deepEqual(result.generatedTargets, ["image_description"]);
  assert.deepEqual(result.failedTargets, ["expression", "auxiliary"]);
  assert.equal(result.resourceLimited, false);
  assert.equal(result.detail, merged);
});

const rules = {
  hasGeneratedContent(value: CardRecordDetail, target: CardGenerationTarget): boolean {
    if (target === "expression") return Boolean(value.rewrittenText?.trim());
    if (target === "translation") return Boolean(value.translationText?.trim());
    if (target === "auxiliary") return Boolean(
      value.auxiliarySegments?.length
      || value.contentBlocks.some((block) => block.auxiliarySegments?.length),
    );
    if (target === "image_description") return Boolean(value.images?.length)
      && value.images!.every((image) => image.descriptionStatus === "completed" && Boolean(image.descriptionText?.trim()));
    return Boolean(value.replyText?.trim());
  },
  isResourceLimitedError(): boolean {
    return false;
  },
};
