import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCardExpressionPrompt,
  CARD_EXPRESSION_PROMPT_VERSION,
} from "./cardExpressionPrompt.js";

test("preserves narrative order while allowing adjacent ideas to be naturalized", () => {
  const prompt = buildCardExpressionPrompt({
    text: "我在门口等人，然后去旁边躲雨。",
    languageCode: "en-US",
    appLocale: "zh-CN",
  });

  assert.equal(CARD_EXPRESSION_PROMPT_VERSION, "card_expression_v4");
  assert.match(prompt.systemPrompt, /Preserve the source's narrative and logical order/u);
  assert.match(prompt.systemPrompt, /Only combine source ideas that are adjacent/u);
  assert.doesNotMatch(prompt.systemPrompt, /reorder ideas/u);
});
