import assert from "node:assert/strict";
import test from "node:test";
import type { CardSpeechGenerateInput } from "../../services/card/CardSpeechService.js";
import type { TtsStreamingGeneration } from "../../services/tts/TtsStreamingCoordinator.js";
import { TtsStreamingWorker } from "./TtsStreamingWorker.js";

const job: CardSpeechGenerateInput = {
  userId: "user-1",
  entryId: "entry-1",
  segmentId: null,
  sourceKind: "review_article",
  cacheKey: "cache-1",
  provider: "azure_global",
  voiceCode: "voice-1",
  languageCode: "en-US",
  sourceText: "A sufficiently long article for streaming.",
  sourceTextHash: "hash-1",
};

const generation: TtsStreamingGeneration = {
  generationId: "generation-1",
  cacheKey: job.cacheKey,
  userId: job.userId,
  status: "running",
  job,
  attempt: 1,
  createdAt: Date.now() - 50,
  startedAt: Date.now(),
  firstChunkAt: null,
  completedAt: null,
  assetId: null,
  audioUrl: null,
  errorCode: null,
};

test("streaming worker writes chunks in order, publishes the asset, and acknowledges the job", async () => {
  const calls: string[] = [];
  const chunks: Buffer[] = [];
  const coordinator = {
    renewJobLease: async () => undefined,
    appendAudioChunk: async (_generationId: string, chunk: Buffer) => {
      await new Promise((resolve) => setTimeout(resolve, chunk[0] === 1 ? 5 : 0));
      chunks.push(chunk);
      calls.push(`chunk:${chunk[0]}`);
    },
    markReady: async (input: { generationId: string; assetId: string; audioUrl: string }) => {
      calls.push(`ready:${input.assetId}`);
    },
    markFailed: async () => { calls.push("failed"); },
    ackJob: async () => { calls.push("ack"); },
  };
  const cardSpeechService = {
    generateStreaming: async (_job: CardSpeechGenerateInput, _generationId: string, onChunk: (chunk: Buffer) => void) => {
      onChunk(Buffer.from([1]));
      onChunk(Buffer.from([2]));
      return {
        asset: { id: "asset-1", objectUrl: "https://audio.test/asset.mp3" },
        synthesis: {
          audio: Buffer.from([1, 2]),
          providerTimings: { firstByteMs: 12, finishMs: 35, networkMs: 4 },
        },
      };
    },
  };
  const worker = new TtsStreamingWorker(coordinator as never, cardSpeechService as never);

  await (worker as any).process("1-0", generation);

  assert.deepEqual(chunks.map((chunk) => chunk[0]), [1, 2]);
  assert.deepEqual(calls, ["chunk:1", "chunk:2", "ready:asset-1", "ack"]);
});

test("streaming worker marks a failed generation and still acknowledges the job", async () => {
  const calls: string[] = [];
  const coordinator = {
    renewJobLease: async () => undefined,
    appendAudioChunk: async () => undefined,
    markReady: async () => { calls.push("ready"); },
    markFailed: async (_generationId: string, errorCode: string) => { calls.push(`failed:${errorCode}`); },
    ackJob: async () => { calls.push("ack"); },
  };
  const cardSpeechService = {
    generateStreaming: async () => { throw new Error("AZURE_TEST_FAILURE"); },
  };
  const worker = new TtsStreamingWorker(coordinator as never, cardSpeechService as never);

  await (worker as any).process("2-0", generation);

  assert.deepEqual(calls, ["failed:AZURE_TEST_FAILURE", "ack"]);
});
