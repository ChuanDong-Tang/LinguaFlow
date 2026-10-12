import assert from "node:assert/strict";
import test from "node:test";
import { usesChinesePostRefinement } from "./AzureGlobalSttProvider.js";
const input = {postRefinement:true,candidateLanguages:["zh-CN"],languageIdMode:"at_start" as const};
test("refinement is limited to opted-in Chinese dictation in validated region",()=>{
  assert.equal(usesChinesePostRefinement(input,"southeastasia"),true);
  assert.equal(usesChinesePostRefinement({...input,postRefinement:undefined},"southeastasia"),false);
  assert.equal(usesChinesePostRefinement({...input,pronunciationReferenceText:"hello"},"southeastasia"),false);
  assert.equal(usesChinesePostRefinement({...input,candidateLanguages:["en-US"]},"southeastasia"),false);
  assert.equal(usesChinesePostRefinement({...input,candidateLanguages:["zh-CN","en-US"],languageIdMode:"continuous"},"southeastasia"),false);
  assert.equal(usesChinesePostRefinement(input,"eastasia"),false);
});
