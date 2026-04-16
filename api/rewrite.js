import { sendJson, readJsonBody } from "../server/core/http.js";
import { getRewriteConfig } from "../server/services/rewriteConfig.js";
import {
  buildOioChatBeginnerUserPrompt,
  buildOioChatAdvancedUserPrompt,
  buildOioChatPracticeFeedbackPrompt,
  buildOioChatPracticeQuestionPrompt,
  buildRewriteUserPrompt,
  OIO_CHAT_BEGINNER_SYSTEM_PROMPT,
  OIO_CHAT_ADVANCED_SYSTEM_PROMPT,
  OIO_CHAT_PRACTICE_FEEDBACK_SYSTEM_PROMPT,
  OIO_CHAT_PRACTICE_QUESTION_SYSTEM_PROMPT,
  REWRITE_SYSTEM_PROMPT,
} from "../server/services/rewritePrompt.js";
import { findBlockedPattern, looksLikePromptInjection } from "../server/services/rewriteSecurity.js";
import { getRewriteAccessContext, recordSuccessfulRewriteUsage } from "../server/services/rewriteUsage.js";

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

function parseOioChatPayload(content, config) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (parsed?.version !== "4") return null;
  if (typeof parsed?.natural_version !== "string" || !parsed.natural_version.trim()) return null;
  if (typeof parsed?.reply !== "string" || !parsed.reply.trim()) return null;

  const keyPhrases = normalizeKeyPhrases(parsed.key_phrases, config);
  if (keyPhrases.length < 1 || keyPhrases.length > config.maxKeyPhrases) return null;

  return {
    version: "4",
    natural_version: parsed.natural_version.trim(),
    reply: parsed.reply.trim(),
    key_phrases: keyPhrases,
  };
}

function parsePracticeQuestionPayload(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (parsed?.version !== "1") return null;
  if (typeof parsed?.question !== "string" || !parsed.question.trim()) return null;

  return {
    version: "1",
    question: parsed.question.trim(),
  };
}

function parsePracticeFeedbackPayload(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (parsed?.version === "2") {
    if (typeof parsed?.is_already_natural !== "boolean") return null;
    if (typeof parsed?.rewritten_answer !== "string") return null;
    if (typeof parsed?.feedback !== "string" || !parsed.feedback.trim()) return null;
    return {
      version: "2",
      is_already_natural: parsed.is_already_natural,
      rewritten_answer: parsed.rewritten_answer.trim(),
      feedback: parsed.feedback.trim(),
    };
  }

  if (parsed?.version !== "1") return null;
  if (typeof parsed?.feedback !== "string" || !parsed.feedback.trim()) return null;

  return {
    version: "2",
    is_already_natural: true,
    rewritten_answer: "",
    feedback: parsed.feedback.trim(),
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

function clipText(value, maxChars) {
  const text = String(value ?? "");
  const max = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function clipJoinedParts(parts, maxChars) {
  let remaining = Math.max(0, Math.floor(Number(maxChars) || 0));
  let hasAny = false;
  return parts.map((raw) => {
    const text = String(raw ?? "");
    if (!text) return "";
    const separatorCost = hasAny ? 1 : 0;
    if (remaining <= separatorCost) return "";
    const clipped = text.slice(0, remaining - separatorCost);
    if (!clipped) return "";
    remaining -= separatorCost + clipped.length;
    hasAny = true;
    return clipped;
  });
}

function clipPracticeQuestionInputs(contextText, targetPhrase, maxChars) {
  const max = Math.max(0, Math.floor(Number(maxChars) || 0));
  const safeTargetPhrase = clipText(targetPhrase, max);
  const separatorCost = safeTargetPhrase && contextText ? 1 : 0;
  const remainingForContext = Math.max(0, max - safeTargetPhrase.length - separatorCost);
  return {
    contextText: clipText(contextText, remainingForContext),
    targetPhrase: safeTargetPhrase,
  };
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
  const rawPracticeQuestion = typeof body?.question === "string" ? body.question.trim() : "";
  const rawPracticeAnswer = typeof body?.answer === "string" ? body.answer.trim() : "";
  const rawPracticeReference = typeof body?.reference_answer === "string" ? body.reference_answer.trim() : "";
  const rawPracticeContextText = typeof body?.context_text === "string" ? body.context_text.trim() : "";
  const rawPracticeTargetPhrase = typeof body?.target_phrase === "string" ? body.target_phrase.trim() : "";
  const safetyMaxInputChars = Math.max(1, Math.floor(Number(config.safetyMaxInputChars) || 5000));
  const text = clipText(rawText, safetyMaxInputChars);
  const practiceQuestionInputs = clipPracticeQuestionInputs(
    rawPracticeContextText,
    rawPracticeTargetPhrase,
    safetyMaxInputChars,
  );
  const [
    practiceQuestion,
    practiceAnswer,
    practiceFeedbackTargetPhrase,
    practiceReference,
  ] = clipJoinedParts(
    [rawPracticeQuestion, rawPracticeAnswer, rawPracticeTargetPhrase, rawPracticeReference],
    safetyMaxInputChars,
  );
  const practiceContextText = practiceQuestionInputs.contextText;
  const practiceTargetPhrase = practiceQuestionInputs.targetPhrase;
  const inputBundle = mode === "practice_question"
    ? [practiceContextText, practiceTargetPhrase].filter(Boolean).join("\n")
    : mode === "practice_feedback"
      ? [practiceQuestion, practiceAnswer, practiceFeedbackTargetPhrase, practiceReference].filter(Boolean).join("\n")
      : text;
  const minRequired = mode === "practice_question" || mode === "practice_feedback"
    ? 1
    : config.minInputChars;
  if (mode === "practice_question" && !practiceTargetPhrase) {
    sendJson(res, 400, { error: { code: "TARGET_PHRASE_REQUIRED", message: "A target phrase is required for practice." } });
    return;
  }
  if (inputBundle.length < minRequired) {
    sendJson(res, 400, { error: { code: "INPUT_TOO_SHORT", message: "Please enter more text before rewriting." } });
    return;
  }

  const access = await getRewriteAccessContext(req, config, mode);
  if (!access.ok) {
    sendJson(res, access.status ?? 401, { error: { code: access.code, message: access.message } });
    return;
  }
  const remainingChars = getRemainingDailyChars(access);
  if (inputBundle.length > remainingChars) {
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
      ? { systemPrompt: OIO_CHAT_BEGINNER_SYSTEM_PROMPT, buildUserPrompt: buildOioChatBeginnerUserPrompt, input: text }
      : mode === "advanced"
        ? { systemPrompt: OIO_CHAT_ADVANCED_SYSTEM_PROMPT, buildUserPrompt: buildOioChatAdvancedUserPrompt, input: text }
        : mode === "practice_question"
          ? {
            systemPrompt: OIO_CHAT_PRACTICE_QUESTION_SYSTEM_PROMPT,
            buildUserPrompt: buildOioChatPracticeQuestionPrompt,
            input: { contextText: practiceContextText, targetPhrase: practiceTargetPhrase },
          }
          : mode === "practice_feedback"
            ? {
              systemPrompt: OIO_CHAT_PRACTICE_FEEDBACK_SYSTEM_PROMPT,
              buildUserPrompt: buildOioChatPracticeFeedbackPrompt,
              input: { question: practiceQuestion, answer: practiceAnswer, targetPhrase: practiceFeedbackTargetPhrase, referenceAnswer: practiceReference },
            }
            : { systemPrompt: REWRITE_SYSTEM_PROMPT, buildUserPrompt: buildRewriteUserPrompt, input: text };
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

  const parsed = mode === "beginner" || mode === "advanced"
    ? parseOioChatPayload(rawContent, config)
    : mode === "practice_question"
      ? parsePracticeQuestionPayload(rawContent)
      : mode === "practice_feedback"
        ? parsePracticeFeedbackPayload(rawContent)
        : parseModelPayload(rawContent, config);
  if (!parsed) {
    sendJson(res, 502, { error: { code: "INVALID_MODEL_RESPONSE", message: "The model response could not be validated." } });
    return;
  }

  const outputChars =
    mode === "beginner" || mode === "advanced"
      ? parsed.natural_version.length + parsed.reply.length
      : mode === "practice_question"
        ? parsed.question.length
        : mode === "practice_feedback"
          ? parsed.feedback.length + (parsed.rewritten_answer?.length ?? 0)
          : parsed.rewritten_text.length;
  const chargedChars = inputBundle.length + outputChars;
  await recordSuccessfulRewriteUsage(access, {
    inputChars: inputBundle.length,
    outputChars,
  });

  sendJson(res, 200, {
    ...parsed,
    usage: buildUsageSnapshot(access, chargedChars),
  });
}
