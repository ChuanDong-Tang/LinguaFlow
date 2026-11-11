import assert from "node:assert/strict";
import test from "node:test";
import { buildCardTopicPrompt, CARD_TOPIC_PROMPT_VERSION, parseCardTitlesOutput } from "./cardTopicPrompt.ts";

test("v4 prompt asks for a topic, a headline and a keyword", () => {
  const prompt = buildCardTopicPrompt({ text: "今天第一次自己修好了自行车链条", appLocale: "zh-CN" });
  assert.equal(prompt.version, CARD_TOPIC_PROMPT_VERSION);
  assert.match(prompt.systemPrompt, /<topic>…<\/topic><headline>…<\/headline><keyword>…<\/keyword>/u);
});

test("parses topic, headline and keyword", () => {
  assert.deepEqual(parseCardTitlesOutput("<topic>第一次自己修好自行车链条</topic><headline>满手油，但链条是我修好的！</headline><keyword>骑车</keyword>"), {
    topic: "第一次自己修好自行车链条",
    headline: "满手油，但链条是我修好的！",
    keyword: "骑车",
  });
});

test("headline and keyword are optional and dropped when they repeat the topic", () => {
  assert.deepEqual(parseCardTitlesOutput("<topic>雨天在便利店等雨停</topic>"), { topic: "雨天在便利店等雨停", headline: null, keyword: null });
  assert.equal(parseCardTitlesOutput("<topic>同一个</topic><headline>同一个</headline>").headline, null);
  assert.equal(parseCardTitlesOutput("<topic>装修</topic><keyword>装修</keyword>").keyword, null);
  assert.equal(parseCardTitlesOutput("<topic>开会</topic><keyword>#工作。</keyword>").keyword, "工作");
});

test("missing topic still fails", () => {
  assert.throws(() => parseCardTitlesOutput("<headline>只有标题</headline>"));
});
