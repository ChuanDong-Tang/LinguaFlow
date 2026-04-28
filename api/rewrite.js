import { sendJson, readJsonBody } from "../server/core/http.js";
import { getRewriteConfig } from "../server/services/rewriteConfig.js";
import {
  buildOioChatBeginnerUserPrompt,
  buildOioChatAdvancedUserPrompt,
  OIO_CHAT_BEGINNER_SYSTEM_PROMPT,
  OIO_CHAT_ADVANCED_SYSTEM_PROMPT,
} from "../server/services/rewritePrompt.js";
import { findBlockedPattern, looksLikePromptInjection } from "../server/services/rewriteSecurity.js";
import { getRewriteAccessContext, recordSuccessfulRewriteUsage } from "../server/services/rewriteUsage.js";

const EFFECTIVE_CHAR_REGEX = /[\p{L}\p{N}]/u;

function parseOioChatPayload(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (parsed?.version !== "4") return null;
  if (typeof parsed?.natural_version !== "string" || !parsed.natural_version.trim()) return null;
  if (typeof parsed?.reply !== "string" || !parsed.reply.trim()) return null;

  return {
    version: "4",
    natural_version: parsed.natural_version.trim(),
    reply: parsed.reply.trim(),
    key_phrases: [],
  };
}

function buildUsageSnapshot(access, chargedChars = 0) {
  const quota = access?.actor?.quota;
  if (!quota) return null;
  return {
    daily_used: Math.max(0, Number(quota.count) + Math.max(0, Number(chargedChars) || 0)),
    daily_limit: Math.max(1, Number(quota.limit) || 20),
  };
}

function getRemainingDailyChars(access) {
  const quota = access?.actor?.quota;
  if (!quota) return 0;
  const used = Math.max(0, Number(quota.count) || 0);
  const limit = Math.max(0, Number(quota.limit) || 0);
  return Math.max(0, limit - used);
}

function countEffectiveChars(value) {
  const text = String(value ?? "");
  let count = 0;
  for (const char of text) {
    if (EFFECTIVE_CHAR_REGEX.test(char)) count += 1;
  }
  return count;
}

function clipText(value, maxChars) {
  const text = String(value ?? "");
  const max = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (text.length <= max) return text;
  return text.slice(0, max);
}


async function callDeepSeek(text, config, prompt) {
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
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: prompt.buildUserPrompt(text) },
        ],
        temperature : 1.2
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

  const rawText = typeof body?.text === "string" ? body.text.trim() : "";
  const mode = typeof body?.mode === "string" ? body.mode.trim() : "";
  const safetyMaxInputChars = Math.max(1, Math.floor(Number(config.safetyMaxInputChars) || 5000));
  const text = clipText(rawText, safetyMaxInputChars);
  const inputBundle = text;
  const minRequired = config.minInputChars;
  const inputBundleEffectiveChars = countEffectiveChars(inputBundle);
  if (inputBundleEffectiveChars < minRequired) {
    sendJson(res, 400, { error: { code: "INPUT_TOO_SHORT", message: "Please enter more text before rewriting." } });
    return;
  }

  const access = await getRewriteAccessContext(req, config, mode);
  if (!access.ok) {
    sendJson(res, access.status ?? 401, { error: { code: access.code, message: access.message } });
    return;
  }
  const remainingChars = getRemainingDailyChars(access);
  if (inputBundleEffectiveChars > remainingChars) {
    sendJson(res, 400, {
      error: {
        code: "INPUT_EXCEEDS_DAILY_REMAINING",
        message: `Input exceeds remaining daily characters (${remainingChars}).`,
      },
    });
    return;
  }

  const blockedInput = findBlockedPattern(inputBundle, config.inputBlocklist);
  if (blockedInput || looksLikePromptInjection(inputBundle)) {
    sendJson(res, 400, { error: { code: "UNSAFE_INPUT", message: "The input cannot be processed." } });
    return;
  }

  let rawContent = "";
  try {
    const prompt = mode === "beginner"
      ? {
        systemPrompt: OIO_CHAT_BEGINNER_SYSTEM_PROMPT,
        buildUserPrompt: buildOioChatBeginnerUserPrompt,
        input: { learnerText: text },
      }
      : {
        systemPrompt: OIO_CHAT_ADVANCED_SYSTEM_PROMPT,
        buildUserPrompt: buildOioChatAdvancedUserPrompt,
        input: { learnerText: text },
      };
    rawContent = await callDeepSeek(prompt.input, config, prompt);
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

  let parsed;
  parsed = parseOioChatPayload(rawContent);

  if (!parsed) {
    sendJson(res, 502, { error: { code: "INVALID_MODEL_RESPONSE", message: "The model response could not be validated." } });
    return;
  }

  const outputChars = countEffectiveChars(parsed.natural_version) + countEffectiveChars(parsed.reply);
  const chargedChars = inputBundleEffectiveChars + outputChars;
  await recordSuccessfulRewriteUsage(access, {
    inputChars: inputBundleEffectiveChars,
    outputChars,
  });

  sendJson(res, 200, {
    ...parsed,
    usage: buildUsageSnapshot(access, chargedChars),
  });
}
