import assert from "node:assert/strict";
import test from "node:test";
import { buildCardThemeKeywordPrompt, parseCardThemeKeywordOutput } from "./cardThemeKeywordPrompt.ts";

test("keyword prompt includes the summary and asks for one tag", () => {
  const prompt = buildCardThemeKeywordPrompt({ text: "今天和工长确认了瓷砖的颜色", topic: "确认瓷砖颜色", appLocale: "zh-CN" });
  assert.match(prompt.userPrompt, /<summary>确认瓷砖颜色<\/summary>/u);
  assert.match(prompt.systemPrompt, /<keyword>…<\/keyword>/u);
});

test("parses and cleans the keyword; rejects empty or a copy of the topic", () => {
  assert.equal(parseCardThemeKeywordOutput("<keyword>#装修。</keyword>", "确认瓷砖颜色"), "装修");
  assert.throws(() => parseCardThemeKeywordOutput("<keyword></keyword>"));
  assert.throws(() => parseCardThemeKeywordOutput("<keyword>装修</keyword>", "装修"));
});
