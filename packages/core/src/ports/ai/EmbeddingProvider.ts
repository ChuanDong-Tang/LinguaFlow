export interface EmbeddingResult {
  embedding: number[];
  provider: string;
  model: string;
  modelVersion: string;
  dimensions: number;
  requestId: string | null;
  promptTokens: number | null;
}

export interface EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  embed(input: string, signal?: AbortSignal): Promise<EmbeddingResult>;
}
