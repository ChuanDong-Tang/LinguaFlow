import assert from "node:assert/strict";
import test from "node:test";

import { getPromptProfile } from "./rewriteAssistantPrompt.js";

test("rewrite prompts require complete grounded fidelity without sacrificing natural style", () => {
  for (const contactCode of ["rewrite_assistant", "english_friend"] as const) {
    const prompt = getPromptProfile({
      contactCode,
      language: "en-US",
      appLocale: "zh-CN",
    }).systemPrompt;

    assert.match(prompt, /Preserve every explicit meaningful detail/u);
    assert.match(prompt, /Do not drop a detail just to make the rewrite shorter/u);
    assert.match(prompt, /Never infer or add a concrete detail/u);
    assert.match(prompt, /Preserve ambiguity for both people and animals/u);
    assert.match(prompt, /Preserve degree exactly/u);
    assert.match(prompt, /silently compare each source clause/u);
    assert.match(prompt, /Vivid does not mean inventing/u);
    assert.doesNotMatch(prompt, /simplify, or shorten/u);
  }
});
