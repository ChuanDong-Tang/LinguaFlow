import assert from "node:assert/strict";
import test from "node:test";
import { buildCardThemePrompt, parseCardThemeOutput } from "./cardThemePrompt.ts";

test("numbers the titles for the model", () => {
  const prompt = buildCardThemePrompt({ titles: ["收到交房通知", "敲定装修公司"], appLocale: "zh-CN" });
  assert.equal(prompt.userPrompt, "1. 收到交房通知\n2. 敲定装修公司");
  assert.match(prompt.systemPrompt, /Simplified Chinese/u);
});

test("parses themes into 0-based indexes and drops invalid ones", () => {
  const output = 'Sure! {"themes":[{"label":"新房装修","items":[1,2,2,9]},{"label":"太少","items":[3]},{"label":"新房装修","items":[1,3]},{"label":"日本旅行 ✈️","items":[3,4]}]}';
  assert.deepEqual(parseCardThemeOutput(output, 4), [
    { label: "新房装修", items: [0, 1] },
    { label: "日本旅行", items: [2, 3] },
  ]);
});

test("invalid JSON fails", () => {
  assert.throws(() => parseCardThemeOutput("no json here", 3));
});
