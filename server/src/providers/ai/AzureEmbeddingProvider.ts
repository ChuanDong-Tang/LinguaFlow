import type { EmbeddingProvider, EmbeddingResult } from "@lf/core/ports/ai/EmbeddingProvider.js";

type FetchLike = typeof fetch;

export interface AzureEmbeddingProviderConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
  model: string;
  dimensions: number;
  timeoutMs: number;
}

export class AzureEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "azure_openai";
  readonly modelName: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  private readonly endpoint: string;

  constructor(
    private readonly config: AzureEmbeddingProviderConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!config.endpoint || !config.apiKey || !config.deployment || !config.apiVersion) {
      throw embeddingError("AZURE_EMBEDDING_CONFIG_INVALID", "Azure embedding configuration is incomplete");
    }
    if (config.dimensions !== 1536) {
      throw embeddingError("AZURE_EMBEDDING_DIMENSIONS_INVALID", "Card embeddings must use 1536 dimensions");
    }
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.modelName = config.model;
    this.dimensions = config.dimensions;
    this.modelVersion = `${config.model}:${config.deployment}:${config.apiVersion}:${config.dimensions}`;
  }

  async embed(input: string, signal?: AbortSignal): Promise<EmbeddingResult> {
    const normalizedInput = input.trim();
    if (!normalizedInput) throw embeddingError("AZURE_EMBEDDING_INPUT_EMPTY", "Embedding input is empty");

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.config.timeoutMs);
    const onAbort = () => timeoutController.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const url = `${this.endpoint}/openai/deployments/${encodeURIComponent(this.config.deployment)}/embeddings?api-version=${encodeURIComponent(this.config.apiVersion)}`;
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.config.apiKey,
        },
        body: JSON.stringify({ input: normalizedInput, dimensions: this.dimensions }),
        signal: timeoutController.signal,
      });
      const requestId = response.headers.get("apim-request-id") ?? response.headers.get("x-request-id");
      const payload = await response.json() as {
        data?: Array<{ embedding?: unknown }>;
        usage?: { prompt_tokens?: unknown };
        error?: { code?: unknown; message?: unknown };
      };
      if (!response.ok) {
        const code = typeof payload.error?.code === "string" ? payload.error.code : `HTTP_${response.status}`;
        const message = typeof payload.error?.message === "string" ? payload.error.message : "Azure embedding request failed";
        throw embeddingError(`AZURE_EMBEDDING_${code}`.toUpperCase(), message.slice(0, 500), response.status);
      }
      const embedding = payload.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length !== this.dimensions || embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        throw embeddingError("AZURE_EMBEDDING_RESPONSE_INVALID", "Azure returned an invalid embedding vector");
      }
      return {
        embedding: embedding as number[],
        provider: this.providerName,
        model: this.modelName,
        modelVersion: this.modelVersion,
        dimensions: this.dimensions,
        requestId,
        promptTokens: typeof payload.usage?.prompt_tokens === "number" ? payload.usage.prompt_tokens : null,
      };
    } catch (error) {
      if (timeoutController.signal.aborted && !signal?.aborted) {
        throw embeddingError("AZURE_EMBEDDING_TIMEOUT", "Azure embedding request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

function embeddingError(code: string, message: string, status?: number): Error {
  const error = new Error(message) as Error & { code: string; status?: number };
  error.code = code;
  error.status = status;
  return error;
}
