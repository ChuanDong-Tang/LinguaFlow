const DEFAULT_INPUT_BLOCKLIST = [
  "api key",
  "apikey",
  "access token",
  "bearer token",
  "password",
  "secret",
  "system prompt",
  "hidden prompt",
  "developer message",
  "ignore previous instructions",
  "reveal your instructions",
  "environment variable",
];

const DEFAULT_OUTPUT_BLOCKLIST = [
  "sk-",
  "api key",
  "system prompt",
  "developer message",
  "environment variable",
  "authorization: bearer",
];

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return value === "true";
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePatternList(value, fallback) {
  if (!value?.trim()) return fallback;
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function getRewriteConfig() {
  return {
    enabled: parseBoolean(process.env.REWRITE_ENABLED, true),
    requireUserId: parseBoolean(process.env.REWRITE_REQUIRE_USER_ID, false),
    minInputChars: parseInteger(process.env.REWRITE_MIN_INPUT_CHARS, 1),
    maxInputChars: parseInteger(process.env.REWRITE_MAX_INPUT_CHARS, 5000),
    maxKeyPhrases: parseInteger(process.env.REWRITE_MAX_KEY_PHRASES, 3),
    maxKeyPhraseWords: parseInteger(process.env.REWRITE_MAX_KEY_PHRASE_WORDS, 8),
    deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
    deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, ""),
    deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    deepseekTimeoutMs: parseInteger(process.env.DEEPSEEK_TIMEOUT_MS, 20000),
    inputBlocklist: parsePatternList(process.env.REWRITE_INPUT_BLOCKLIST, DEFAULT_INPUT_BLOCKLIST),
    outputBlocklist: parsePatternList(process.env.REWRITE_OUTPUT_BLOCKLIST, DEFAULT_OUTPUT_BLOCKLIST),
  };
}
