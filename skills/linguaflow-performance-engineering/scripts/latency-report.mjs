#!/usr/bin/env node

import fs from "node:fs";

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: latency-report.mjs --input <file|-> [--json] [--minimum-samples <n>]");
  process.exit(2);
}

let input = "";
let jsonOutput = false;
let minimumSamples = 20;
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--input") input = process.argv[++index] ?? "";
  else if (arg === "--json") jsonOutput = true;
  else if (arg === "--minimum-samples") minimumSamples = Number(process.argv[++index]);
  else if (arg === "-h" || arg === "--help") usage();
  else usage(`Unknown option: ${arg}`);
}
if (!input) usage("--input is required");
if (!Number.isInteger(minimumSamples) || minimumSamples < 1) usage("--minimum-samples must be a positive integer");

const raw = input === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(input, "utf8");
let records;
try {
  const parsed = JSON.parse(raw);
  records = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  records = raw.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
    }
  });
}

const groups = new Map();
for (const [index, record] of records.entries()) {
  const metric = typeof record?.metric === "string" ? record.metric.trim() : "";
  const durationMs = Number(record?.durationMs);
  if (!metric || !Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error(`Record ${index + 1} requires a non-empty metric and non-negative durationMs`);
  }
  const group = groups.get(metric) ?? { durations: [], errors: 0 };
  group.durations.push(durationMs);
  if (record.ok === false || (Number.isInteger(record.statusCode) && record.statusCode >= 500)) group.errors += 1;
  groups.set(metric, group);
}

function percentile(sorted, value) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((value / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))];
}

const report = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([metric, group]) => {
  const durations = group.durations.sort((a, b) => a - b);
  return {
    metric,
    samples: durations.length,
    confidence: durations.length < minimumSamples ? "insufficient" : durations.length < 100 ? "provisional" : "stable",
    errors: group.errors,
    errorRate: group.errors / durations.length,
    p50Ms: percentile(durations, 50),
    p90Ms: percentile(durations, 90),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: durations.at(-1),
  };
});

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log("metric\tsamples\tconfidence\terrors\terror_rate\tp50_ms\tp90_ms\tp95_ms\tp99_ms\tmax_ms");
  for (const item of report) {
    console.log([
      item.metric,
      item.samples,
      item.confidence,
      item.errors,
      item.errorRate.toFixed(4),
      item.p50Ms,
      item.p90Ms,
      item.p95Ms,
      item.p99Ms,
      item.maxMs,
    ].join("\t"));
  }
}
