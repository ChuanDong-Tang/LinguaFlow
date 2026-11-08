import assert from "node:assert/strict";
import test from "node:test";
import { buildCardTopicPrompt, CARD_TOPIC_PROMPT_VERSION, parseCardTitlesOutput } from "./cardTopicPrompt.ts";

test("v3 prompt asks for both a topic and a headline", () => {
  const prompt = buildCardTopicPrompt({ text: "今天第一次自己修好了自行车链条", appLocale: "zh-CN" });
  assert.equal(prompt.version, CARD_TOPIC_PROMPT_VERSION);
  assert.match(prompt.systemPrompt, /<topic>…<\/topic><headline>…<\/headline>/u);
});

test("parses topic and headline", () => {
  assert.deepEqual(parseCardTitlesOutput("<topic>第一次自己修好自行车链条</topic><headline>满手油，但链条是我修好的！</headline>"), {
    topic: "第一次自己修好自行车链条",
    headline: "满手油，但链条是我修好的！",
  });
});

test("headline is optional and dropped when it repeats the topic", () => {
  assert.deepEqual(parseCardTitlesOutput("<topic>雨天在便利店等雨停</topic>"), { topic: "雨天在便利店等雨停", headline: null });
  assert.equal(parseCardTitlesOutput("<topic>同一个</topic><headline>同一个</headline>").headline, null);
});

test("missing topic still fails", () => {
  assert.throws(() => parseCardTitlesOutput("<headline>只有标题</headline>"));
});
