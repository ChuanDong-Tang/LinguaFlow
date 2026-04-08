import { getRewriteConfig } from "./_lib/rewriteConfig.js";
import { buildRewriteUserPrompt, REWRITE_SYSTEM_PROMPT } from "./_lib/rewritePrompt.js";
import { findBlockedPattern, looksLikePromptInjection } from "./_lib/rewriteSecurity.js";
import { getRewriteAccessContext, recordSuccessfulRewriteUsage } from "./_lib/rewriteUsage.js";

function sendJson(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(payload));
}

function createError(code, message, status) {
  return {
    status,
    body: {
      error: { code, message },
    },
  };
}

function countWords(text) {
  const matches = String(text ?? "").trim().match(/\b[\w'-]+\b/g);
  return matches?.length ?? 0;
}

function normalizeKeyPhrases(value, config) {
  if (!Array.isArray(value)) return [];

  const unique = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const phrase = raw.trim().replace(/\s+/g, " ");
    if (!phrase) continue;
    if (countWords(phrase) > config.maxKeyPhraseWords) continue;
    if (!unique.some((item) => item.toLowerCase() === phrase.toLowerCase())) {
      unique.push(phrase);
    }
    if (unique.length >= config.maxKeyPhrases) {
      break;
    }
  }

  return unique;
}

function parseModelPayload(content, config) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (parsed?.version !== "1") return null;
  if (typeof parsed?.rewritten_text !== "string" || !parsed.rewritten_text.trim()) return null;

  const keyPhrases = normalizeKeyPhrases(parsed.key_phrases, config);
  if (keyPhrases.length < 1 || keyPhrases.length > config.maxKeyPhrases) return null;

  return {
    version: "1",
    rewritten_text: parsed.rewritten_text.trim(),
    key_phrases: keyPhrases,
  };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function callDeepSeek(text, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.deepseekTimeoutMs);

  try {
    const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseekModel,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: REWRITE_SYSTEM_PROMPT },
          { role: "user", content: buildRewriteUserPrompt(text) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`DeepSeek request failed with status ${response.status}: ${detail}`);
    }

    const payload = await response.json();
    return payload?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST /api/rewrite." } });
    return;
  }

  const config = getRewriteConfig();
  if (!config.enabled) {
    sendJson(res, 503, { error: { code: "REWRITE_DISABLED", message: "Rewrite is currently unavailable." } });
    return;
  }

  if (!config.deepseekApiKey) {
    sendJson(res, 500, { error: { code: "SERVER_MISCONFIGURED", message: "DeepSeek API key is not configured." } });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
    return;
  }

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < config.minInputChars) {
    sendJson(res, 400, { error: { code: "INPUT_TOO_SHORT", message: "Please enter more text before rewriting." } });
    return;
  }

  if (text.length > config.maxInputChars) {
    sendJson(res, 400, { error: { code: "INPUT_TOO_LONG", message: `Input exceeds the ${config.maxInputChars}-character limit.` } });
    return;
  }

  const access = await getRewriteAccessContext(req, config);
  if (!access.ok) {
    sendJson(res, 401, { error: { code: access.code, message: access.message } });
    return;
  }

  const blockedInput = findBlockedPattern(text, config.inputBlocklist);
  if (blockedInput || looksLikePromptInjection(text)) {
    sendJson(res, 400, { error: { code: "UNSAFE_INPUT", message: "The input cannot be processed." } });
    return;
  }

  let rawContent = "";
  try {
    rawContent = await callDeepSeek(text, config);
  } catch (error) {
    console.error("[rewrite] DeepSeek request failed:", error);
    sendJson(res, 502, { error: { code: "MODEL_REQUEST_FAILED", message: "Rewrite request failed. Please try again." } });
    return;
  }

  const blockedOutput = findBlockedPattern(rawContent, config.outputBlocklist);
  if (blockedOutput) {
    sendJson(res, 502, { error: { code: "UNSAFE_OUTPUT", message: "The model response was blocked." } });
    return;
  }

  const parsed = parseModelPayload(rawContent, config);
  if (!parsed) {
    sendJson(res, 502, { error: { code: "INVALID_MODEL_RESPONSE", message: "The model response could not be validated." } });
    return;
  }

  await recordSuccessfulRewriteUsage(access, {
    inputChars: text.length,
    outputChars: parsed.rewritten_text.length,
    keyPhraseCount: parsed.key_phrases.length,
  });

  sendJson(res, 200, parsed);
}
