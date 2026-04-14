import { sendJson, readJsonBody } from "../server/core/http.js";
import { getRewriteConfig } from "../server/services/rewriteConfig.js";
import {
  buildOioChatAskUserPrompt,
  buildOioChatRewriteUserPrompt,
  buildOioChatPracticeFeedbackPrompt,
  buildOioChatPracticeQuestionPrompt,
  buildRewriteUserPrompt,
  OIO_CHAT_ASK_SYSTEM_PROMPT,
  OIO_CHAT_REWRITE_SYSTEM_PROMPT,
  OIO_CHAT_PRACTICE_FEEDBACK_SYSTEM_PROMPT,
  OIO_CHAT_PRACTICE_QUESTION_SYSTEM_PROMPT,
  REWRITE_SYSTEM_PROMPT,
} from "../server/services/rewritePrompt.js";
import { findBlockedPattern, looksLikePromptInjection } from "../server/services/rewriteSecurity.js";
import { getRewriteAccessContext, recordSuccessfulRewriteUsage } from "../server/services/rewriteUsage.js";

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

function parseChatRewritePayload(content, config) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (parsed?.version !== "3" || parsed?.mode !== "rewrite") return null;
  if (typeof parsed?.is_already_natural !== "boolean") return null;
  if (typeof parsed?.encouragement !== "string") return null;
  if (typeof parsed?.natural_version !== "string") return null;
  if (typeof parsed?.quick_note !== "string" || !parsed.quick_note.trim()) return null;

  const keyPhrases = normalizeKeyPhrases(parsed.key_phrases, config);
  if (keyPhrases.length < 1 || keyPhrases.length > config.maxKeyPhrases) return null;

    return {
    version: "3",
    mode: "rewrite",
    is_already_natural: parsed.is_already_natural,
    encouragement: parsed.encouragement.trim(),
    natural_version: parsed.natural_version.trim(),
    quick_note: parsed.quick_note.trim(),
    key_phrases: keyPhrases,
  };
}

function parseAskPayload(content, config) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (parsed?.version !== "3" || parsed?.mode !== "ask") return null;
  if (typeof parsed?.is_already_natural !== "boolean") return null;
  if (typeof parsed?.encouragement !== "string") return null;
  if (typeof parsed?.natural_version !== "string") return null;
  if (typeof parsed?.answer !== "string" || !parsed.answer.trim()) return null;

  const keyPhrases = normalizeKeyPhrases(parsed.key_phrases, config);
  if (keyPhrases.length < 1 || keyPhrases.length > config.maxKeyPhrases) return null;

  return {
    version: "3",
    mode: "ask",
    is_already_natural: parsed.is_already_natural,
    encouragement: parsed.encouragement.trim(),
    natural_version: parsed.natural_version.trim(),
    answer: parsed.answer.trim(),
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

function buildUsageSnapshot(access, charged = false) {
  const quota = access?.actor?.quota;
  if (!quota) return null;
  return {
    daily_used: Math.max(0, Number(quota.count) + (charged ? 1 : 0)),
    daily_limit: Math.max(1, Number(quota.limit) || 20),
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

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const mode = typeof body?.mode === "string" ? body.mode.trim() : "";
  const practiceQuestion = typeof body?.question === "string" ? body.question.trim() : "";
  const practiceAnswer = typeof body?.answer === "string" ? body.answer.trim() : "";
  const practiceReference = typeof body?.reference_answer === "string" ? body.reference_answer.trim() : "";
  const practiceContextText = typeof body?.context_text === "string" ? body.context_text.trim() : "";
  const practiceTargetPhrase = typeof body?.target_phrase === "string" ? body.target_phrase.trim() : "";
  const inputBundle = mode === "practice_question"
    ? [practiceContextText, practiceTargetPhrase].filter(Boolean).join("\n")
    : mode === "practice_feedback"
      ? [practiceQuestion, practiceAnswer, practiceTargetPhrase, practiceReference].filter(Boolean).join("\n")
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

  if (inputBundle.length > config.maxInputChars) {
    sendJson(res, 400, { error: { code: "INPUT_TOO_LONG", message: `Input exceeds the ${config.maxInputChars}-character limit.` } });
    return;
  }

  const access = await getRewriteAccessContext(req, config, mode);
  if (!access.ok) {
    sendJson(res, access.status ?? 401, { error: { code: access.code, message: access.message } });
    return;
  }

  const blockedInput = findBlockedPattern(inputBundle, config.inputBlocklist);
  if (blockedInput || looksLikePromptInjection(inputBundle)) {
    sendJson(res, 400, { error: { code: "UNSAFE_INPUT", message: "The input cannot be processed." } });
    return;
  }

  let rawContent = "";
  try {
    const prompt = mode === "ask"
      ? { systemPrompt: OIO_CHAT_ASK_SYSTEM_PROMPT, buildUserPrompt: buildOioChatAskUserPrompt, input: text }
      : mode === "rewrite"
        ? { systemPrompt: OIO_CHAT_REWRITE_SYSTEM_PROMPT, buildUserPrompt: buildOioChatRewriteUserPrompt, input: text }
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
              input: { question: practiceQuestion, answer: practiceAnswer, targetPhrase: practiceTargetPhrase, referenceAnswer: practiceReference },
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

  const parsed = mode === "ask"
    ? parseAskPayload(rawContent, config)
    : mode === "rewrite"
      ? parseChatRewritePayload(rawContent, config)
      : mode === "practice_question"
        ? parsePracticeQuestionPayload(rawContent)
        : mode === "practice_feedback"
          ? parsePracticeFeedbackPayload(rawContent)
          : parseModelPayload(rawContent, config);
  if (!parsed) {
    sendJson(res, 502, { error: { code: "INVALID_MODEL_RESPONSE", message: "The model response could not be validated." } });
    return;
  }

  await recordSuccessfulRewriteUsage(access, {
    inputChars: inputBundle.length,
    outputChars:
      mode === "ask"
        ? parsed.natural_version.length + parsed.answer.length
        : mode === "rewrite"
          ? parsed.natural_version.length + parsed.quick_note.length
          : mode === "practice_question"
            ? parsed.question.length
          : mode === "practice_feedback"
              ? parsed.feedback.length + (parsed.rewritten_answer?.length ?? 0)
              : parsed.rewritten_text.length,
    keyPhraseCount:
      mode === "practice_question" || mode === "practice_feedback"
        ? 0
        : parsed.key_phrases.length,
  });

  sendJson(res, 200, {
    ...parsed,
    usage: buildUsageSnapshot(access, true),
  });
}
