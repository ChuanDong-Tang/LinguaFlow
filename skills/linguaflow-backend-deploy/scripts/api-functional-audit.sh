#!/usr/bin/env bash
set -euo pipefail

action="${1:---status}"
case "$action" in
  --status)
    confirm="false"
    ;;
  --probe-if-idle)
    [[ "${2:-}" == "--confirm-production" && $# -eq 2 ]] || {
      echo "Usage: $0 --status | --probe-if-idle --confirm-production" >&2
      exit 2
    }
    confirm="true"
    ;;
  *)
    echo "Usage: $0 --status | --probe-if-idle --confirm-production" >&2
    exit 2
    ;;
esac

ssh oio-main "bash -s -- '$action' '$confirm'" <<'REMOTE'
set -euo pipefail
action="$1"
confirm="$2"
cd /opt/oio-production

curl -fsS --max-time 10 http://127.0.0.1:3102/health >/dev/null
echo "api_health=ok"

ACTION="$action" CONFIRM_PRODUCTION="$confirm" node --env-file=.env --import tsx --input-type=module - <<'NODE'
import { PrismaClient } from "@prisma/client";
import { buildDictionarySystemPrompt, buildDictionaryUserPrompt } from "@lf/core/Prompts/dictionaryLookupPrompt.js";
import { getRuntimeConfig } from "./server/src/config/runtimeConfig.ts";
import { createAIProvider } from "./server/src/providers/ai/createAIProvider.ts";
import { getRedisClient } from "./server/src/infrastructure/redis/redisClient.ts";
import { ResourceGovernor } from "./server/src/services/resource/ResourceGovernor.ts";

const prisma = new PrismaClient();
const percentile = (values, ratio) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};
const summarize = (rows) => {
  const durations = rows.map((row) => Number(row.metadata?.durationMs)).filter(Number.isFinite);
  const failures = rows.filter((row) => row.status === "failed").length;
  return {
    samples: rows.length,
    failures,
    errorRate: rows.length ? Number((failures / rows.length).toFixed(4)) : 0,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations.length ? Math.max(...durations) : null,
    lastAt: rows.at(-1)?.createdAt?.toISOString() ?? null,
  };
};
const safeErrorCode = (error) => {
  if (error && typeof error === "object" && "code" in error) return String(error.code).slice(0, 100);
  return error instanceof Error ? error.name.slice(0, 100) : "SYNTHETIC_DICTIONARY_FAILED";
};

try {
  const now = Date.now();
  let actual = await prisma.systemEventLog.findMany({
    where: { module: "dictionary", event: "dictionary.lookup", createdAt: { gte: new Date(now - 30 * 60_000) } },
    select: { status: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const latestSynthetic = await prisma.systemEventLog.findFirst({
    where: { module: "monitoring", event: "monitor.dictionary.synthetic" },
    select: { status: true, metadata: true, createdAt: true, errorCode: true },
    orderBy: { createdAt: "desc" },
  });
  const actualIdle = !actual.length || actual.at(-1).createdAt.getTime() < now - 10 * 60_000;
  const syntheticDue = !latestSynthetic || latestSynthetic.createdAt.getTime() < now - 10 * 60_000;

  if (process.env.ACTION === "--probe-if-idle" && actualIdle && syntheticDue) {
    if (process.env.CONFIRM_PRODUCTION !== "true") throw new Error("CONFIRM_PRODUCTION_REQUIRED");
    const config = getRuntimeConfig();
    const provider = createAIProvider(config);
    const governor = new ResourceGovernor(config.resourcePolicies, getRedisClient());
    const input = {
      term: "take a break",
      context: "After finishing this task, I should take a break.",
      selectionStart: 37,
      selectionEnd: 49,
      targetLanguage: "en-US",
      uiLanguage: "zh-CN",
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const startedAt = Date.now();
    let output = "";
    let status = "success";
    let errorCode = null;
    try {
      await governor.execute("llm", "maintenance-dictionary-audit", () => provider.generateChatTextStream({
        userId: "maintenance-dictionary-audit",
        text: buildDictionaryUserPrompt(input),
        languageCode: input.targetLanguage,
        appLocale: input.uiLanguage,
        systemPrompt: buildDictionarySystemPrompt(input),
        rawUserPrompt: true,
        maxOutputTokens: config.dictionaryLookupMaxOutputTokens,
        temperature: 0,
        signal: controller.signal,
      }, (event) => { if (event.type === "delta") output += event.text; }), {
        operation: "synthetic_dictionary_lookup",
      });
      const parsed = JSON.parse(output.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim());
      if (!parsed || typeof parsed.targetMeaning !== "string" || typeof parsed.nativeMeaning !== "string") {
        throw Object.assign(new Error("SYNTHETIC_DICTIONARY_OUTPUT_INVALID"), { code: "SYNTHETIC_DICTIONARY_OUTPUT_INVALID" });
      }
    } catch (error) {
      status = "failed";
      errorCode = safeErrorCode(error);
    } finally {
      clearTimeout(timer);
    }
    const durationMs = Date.now() - startedAt;
    await prisma.systemEventLog.create({
      data: {
        module: "monitoring",
        event: "monitor.dictionary.synthetic",
        level: status === "success" && durationMs < 12_000 ? "info" : "warn",
        status,
        errorCode,
        metadata: {
          durationMs,
          provider: provider.providerName,
          model: provider.modelName,
          slow: durationMs >= 12_000,
        },
      },
    });
    console.log(`synthetic_probe=${status}`);
    console.log(`synthetic_duration_ms=${durationMs}`);
    if (errorCode) console.log(`synthetic_error_code=${errorCode}`);
  } else {
    console.log(`synthetic_probe=${process.env.ACTION === "--status" ? "not_requested" : actualIdle ? "not_due" : "skipped_real_traffic"}`);
  }

  actual = await prisma.systemEventLog.findMany({
    where: { module: "dictionary", event: "dictionary.lookup", createdAt: { gte: new Date(now - 30 * 60_000) } },
    select: { status: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const synthetic = await prisma.systemEventLog.findMany({
    where: { module: "monitoring", event: "monitor.dictionary.synthetic", createdAt: { gte: new Date(now - 24 * 60 * 60_000) } },
    select: { status: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const actualSummary = summarize(actual);
  const syntheticSummary = summarize(synthetic);
  console.log(`dictionary_30m=${JSON.stringify(actualSummary)}`);
  console.log(`synthetic_24h=${JSON.stringify(syntheticSummary)}`);
  const degraded = (actualSummary.samples >= 3 && (actualSummary.p95Ms >= 15_000 || actualSummary.errorRate >= 0.2))
    || (syntheticSummary.samples > 0 && (syntheticSummary.failures > 0 || syntheticSummary.p95Ms >= 15_000));
  console.log(`functional_health=${degraded ? "degraded" : "ok"}`);
  if (degraded) process.exitCode = 3;
} finally {
  await prisma.$disconnect();
}
NODE
REMOTE
