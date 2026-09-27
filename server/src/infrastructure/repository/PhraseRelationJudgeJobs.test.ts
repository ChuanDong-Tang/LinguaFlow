import assert from "node:assert/strict";
import test from "node:test";
import { loadPhraseRelationJudgeSourceData, phraseRelationRetrievalConfigFromPayload } from "./PhraseRelationJudgeJobs.js";

test("loads one anchor and a bounded contextual candidate set", async () => {
  const queries: string[] = [];
  let call = 0;
  const prisma = {
    async $queryRaw(strings: TemplateStringsArray) {
      queries.push(strings.join("?"));
      call += 1;
      if (call === 1) return [{ occurrenceId: "anchor", languageCode: "en", surfaceText: "cracking up", sentence: "I was cracking up.", startUtf16: 6, endUtf16: 17 }];
      return [{ occurrenceId: "candidate", languageCode: "en", surfaceText: "burst out laughing", sentence: "I burst out laughing.", startUtf16: 2, endUtf16: 20, semanticScore: "0.91" }];
    },
  };

  const source = await loadPhraseRelationJudgeSourceData(prisma as never, "anchor", "user-1", {
    modelVersion: "embedding-v1", representationVersion: "usage_meaning_v2",
    minPhraseSimilarity: 0.72, minRepresentationSimilarity: 0.45, representationWeight: 0.7,
  });

  assert.equal(source?.candidates[0]?.semanticScore, 0.91);
  assert.match(queries[1] ?? "", /LIMIT 5/u);
  assert.match(queries[1] ?? "", /candidate_context_embedding\."meaningKind" = anchor\."meaningKind"/u);
});

test("rejects incomplete retrieval job payloads", () => {
  assert.equal(phraseRelationRetrievalConfigFromPayload({ modelVersion: "embedding-v1" }), null);
});
