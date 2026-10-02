import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCardContentGenerationPrompt,
  CARD_CONTENT_AUXILIARY_PROMPT_VERSION,
  CARD_REPLY_AUXILIARY_PROMPT_VERSION,
} from "./cardContentGenerationPrompt.js";

test("reply auxiliary requires a direct translation without meta commentary", () => {
  const prompt = buildCardContentGenerationPrompt({
    target: "auxiliary",
    sourceText: JSON.stringify([{ ordinal: 0, text: "Hang in there." }]),
    languageCode: "en-US",
    appLocale: "zh-CN",
    difficulty: "default",
    auxiliaryPurpose: "reply_translation",
  });

  assert.match(prompt.systemPrompt, /direct, faithful, natural translation/u);
  assert.match(prompt.systemPrompt, /Do not explain, analyze, summarize, label, or describe/u);
  assert.match(prompt.systemPrompt, /Do not add advice, context, interpretation, or commentary/u);
  assert.match(prompt.systemPrompt, /Never begin with wording equivalent to "this sentence"/u);
  assert.match(prompt.systemPrompt, /Return XML only/u);
  assert.equal(CARD_REPLY_AUXILIARY_PROMPT_VERSION, "card_reply_auxiliary_v2");
});

test("non-reply auxiliary keeps the existing supporting-text contract", () => {
  const prompt = buildCardContentGenerationPrompt({
    target: "auxiliary",
    sourceText: JSON.stringify([{ ordinal: 0, text: "A finalized expression." }]),
    languageCode: "en-US",
    appLocale: "zh-CN",
    difficulty: "default",
    auxiliaryPurpose: "supporting_text",
  });

  assert.match(prompt.systemPrompt, /auxiliary text that helps the user understand/u);
  assert.doesNotMatch(prompt.systemPrompt, /direct, faithful, natural translation/u);
  assert.equal(CARD_CONTENT_AUXILIARY_PROMPT_VERSION, "card_content_auxiliary_v1");
});
