import assert from "node:assert/strict";
import test from "node:test";
import { buildOioAiSystemPrompt, oioAiDateAnchors, parseDialogueCardOutput } from "./oioAiPrompt.js";

test("date anchors are computed, not left to the model", () => {
  const anchors = oioAiDateAnchors("2026-11-14"); // a Saturday
  assert.ok(anchors.includes("last week (上周) = 2026-11-02 .. 2026-11-08"));
  assert.ok(anchors.includes("this week (本周) = 2026-11-09 .. 2026-11-14"));
  assert.ok(anchors.includes("last month (上个月) = 2026-10-01 .. 2026-10-31"));
  assert.ok(anchors.includes("this time last year (去年这时候) = 2025-11-07 .. 2025-11-21"));
  assert.ok(anchors.includes("last year (去年) = 2025-01-01 .. 2025-12-31"));
});

test("January rolls back to December of the previous year", () => {
  const anchors = oioAiDateAnchors("2027-01-05");
  assert.ok(anchors.includes("last month (上个月) = 2026-12-01 .. 2026-12-31"));
});

test("prompt carries the anchors and the button rule", () => {
  const prompt = buildOioAiSystemPrompt({ today: "2026-11-14", appLocale: "zh-CN" });
  assert.match(prompt, /去年这时候\) = 2025-11-07/);
  assert.match(prompt, /Never talk about buttons/);
});

test("dialogue card output keeps turns paired and single-line", () => {
  const parsed = parseDialogueCardOutput('Sure: {"title":"遛狗","turns":[{"user":"I walked the dog.\\nIt was fun.","oio":"Nice!"},{"user":"He was scared","oio":"Of the dog?"}]}', 2);
  assert.deepEqual(parsed, { title: "遛狗", turns: [{ user: "I walked the dog. It was fun.", oio: "Nice!" }, { user: "He was scared", oio: "Of the dog?" }] });
  assert.equal(parseDialogueCardOutput('{"title":"x","turns":[{"user":"a","oio":""}]}', 1), null);
  assert.equal(parseDialogueCardOutput('{"title":"x","turns":[{"user":"a","oio":"b"}]}', 2), null);
  assert.equal(parseDialogueCardOutput("not json", 1), null);
  assert.equal(parseDialogueCardOutput('{"turns":[{"user":"","oio":"b"}]}', 1), null);
});

test("chat prompt v4 is a companion with boundaries", () => {
  const prompt = buildOioAiSystemPrompt({ today: "2026-11-15", appLocale: "zh-CN" });
  assert.match(prompt, /companion/);
  assert.match(prompt, /Never stack two questions/);
  assert.match(prompt, /Boundaries/);
});
