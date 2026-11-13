import type { AgentChatProvider } from "@lf/core/ports/ai/AgentChatProvider.js";
import type { RuntimeConfig } from "../../config/runtimeConfig.js";
import { OpenAICompatibleAgentProvider } from "./OpenAICompatibleAgentProvider.js";

/**
 * OIO AI's tool-calling model. Grok and DeepSeek speak OpenAI-compatible chat
 * completions with tools; the OpenAI provider uses the Responses API, so it
 * falls back to Grok here. OIO_AI_PROVIDER / OIO_AI_MODEL override.
 */
export function createAgentProvider(config: RuntimeConfig, env: NodeJS.ProcessEnv = process.env): AgentChatProvider {
  const requested = env.OIO_AI_PROVIDER?.trim() || config.aiProvider;
  const model = env.OIO_AI_MODEL?.trim();
  if (requested === "deepseek") {
    return new OpenAICompatibleAgentProvider("deepseek", {
      apiKey: config.deepSeekApiKey, baseUrl: config.deepSeekBaseUrl, model: model || config.deepSeekModel, timeoutMs: 60_000,
    });
  }
  return new OpenAICompatibleAgentProvider("grok", {
    apiKey: config.grokApiKey, baseUrl: config.grokBaseUrl, model: model || config.grokModel, timeoutMs: 60_000,
  });
}
