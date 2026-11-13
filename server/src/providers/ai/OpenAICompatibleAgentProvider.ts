import type {
  AgentChatProvider,
  AgentMessage,
  AgentRoundInput,
  AgentStreamEvent,
  AgentToolCall,
} from "@lf/core/ports/ai/AgentChatProvider.js";

type ChunkJson = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
};

/**
 * Folds streamed chunks of an OpenAI-compatible chat completion into text
 * deltas and complete tool calls (their arguments arrive in pieces, keyed by
 * index). Pure, so the protocol handling is unit-tested without a network.
 */
export class AgentChunkAccumulator {
  private readonly calls = new Map<number, AgentToolCall>();
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

  /** Returns the text delta in this chunk ("" when none). */
  push(chunk: ChunkJson): string {
    if (chunk.usage) {
      const inputTokens = chunk.usage.prompt_tokens ?? 0;
      const outputTokens = chunk.usage.completion_tokens ?? 0;
      this.usage = { inputTokens, outputTokens, totalTokens: chunk.usage.total_tokens ?? inputTokens + outputTokens };
    }
    const delta = chunk.choices?.[0]?.delta;
    for (const piece of delta?.tool_calls ?? []) {
      const index = piece.index ?? 0;
      const current = this.calls.get(index) ?? { id: "", name: "", arguments: "" };
      if (piece.id) current.id = piece.id;
      if (piece.function?.name) current.name += piece.function.name;
      if (piece.function?.arguments) current.arguments += piece.function.arguments;
      this.calls.set(index, current);
    }
    return delta?.content ?? "";
  }

  toolCalls(): AgentToolCall[] {
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
      .filter((call) => call.name);
  }
}

export function toOpenAIMessages(messages: AgentMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

/** Grok (x.ai) and DeepSeek both speak OpenAI-compatible chat completions with tools. */
export class OpenAICompatibleAgentProvider implements AgentChatProvider {
  constructor(
    readonly providerName: string,
    private readonly config: { apiKey: string; baseUrl: string; model: string; timeoutMs?: number; extraBody?: Record<string, unknown> },
  ) {}

  get modelName(): string {
    return this.config.model;
  }

  async streamRound(input: AgentRoundInput, onEvent: (event: AgentStreamEvent) => Promise<void> | void): Promise<void> {
    if (!this.config.apiKey) throw Object.assign(new Error("AI_PROVIDER_NOT_CONFIGURED"), { code: "AI_PROVIDER_NOT_CONFIGURED" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60_000);
    const abort = () => controller.abort();
    if (input.signal?.aborted) controller.abort();
    else input.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.config.model,
          temperature: input.temperature ?? 0.3,
          ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
          stream: true,
          stream_options: { include_usage: true },
          messages: toOpenAIMessages(input.messages),
          ...(input.tools.length ? {
            tools: input.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
            tool_choice: "auto",
          } : {}),
          ...this.config.extraBody,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const upstreamText = await response.text().catch(() => "");
        throw Object.assign(new Error("UPSTREAM_AI_ERROR"), { code: "UPSTREAM_AI_ERROR", status: response.status, upstreamText });
      }
      const accumulator = new AgentChunkAccumulator();
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let finished = false;
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((item) => item.startsWith("data:"));
          const raw = line?.slice(5).trim();
          if (!raw) continue;
          if (raw === "[DONE]") { finished = true; break; }
          const text = accumulator.push(JSON.parse(raw) as ChunkJson);
          if (text) await onEvent({ type: "delta", text });
        }
      }
      const calls = accumulator.toolCalls();
      if (calls.length) await onEvent({ type: "tool_calls", calls });
      await onEvent({ type: "done", usage: accumulator.usage });
    } finally {
      input.signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
    }
  }
}
