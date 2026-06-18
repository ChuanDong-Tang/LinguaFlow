import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { RuntimeConfig } from "../../config/runtimeConfig.js";
import { ChatGPTAIProvider } from "./ChatGptAIProvider.js";
import { DeepSeekAIProvider } from "./DeepSeekAIProvider.js";
import { GrokAIProvider } from "./GrokAIProvider.js";
import { SelectableAIProvider } from "./SelectableAIProvider.js";

export function createAIProvider(config: RuntimeConfig): AIProvider {
  const deepSeekProvider = new DeepSeekAIProvider({
    apiKey: config.deepSeekApiKey,
    baseUrl: config.deepSeekBaseUrl,
    model: config.deepSeekModel,
    timeoutMs: config.deepSeekTimeoutMs,
    allowClientModel: config.aiAllowClientModel,
    allowedModels: config.deepSeekAllowedModels,
  });
  const openAiProvider = new ChatGPTAIProvider({
    apiKey: config.openAiApiKey,
    baseUrl: config.openAiBaseUrl,
    model: config.openAiModel,
    timeoutMs: config.openAiTimeoutMs,
    allowClientModel: config.aiAllowClientModel,
    allowedModels: config.openAiAllowedModels,
  });
  const grokProvider = new GrokAIProvider({
    apiKey: config.grokApiKey,
    baseUrl: config.grokBaseUrl,
    model: config.grokModel,
    timeoutMs: config.grokTimeoutMs,
    allowClientModel: config.aiAllowClientModel,
    allowedModels: config.grokAllowedModels,
  });

  return new SelectableAIProvider(config.aiProvider, {
    deepseek: deepSeekProvider,
    openai: openAiProvider,
    grok: grokProvider,
  }, config.aiAllowClientModel);
}
