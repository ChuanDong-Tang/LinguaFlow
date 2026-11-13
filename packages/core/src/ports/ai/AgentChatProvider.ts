import type { AbortSignalLike } from "./AIProvider.js";

/**
 * Tool-calling chat (OIO AI, 2026-11). One provider round: the model either
 * answers in text or asks for tool calls; the caller runs the tools and calls
 * again with their results until the model answers.
 */
export type AgentToolCall = { id: string; name: string; arguments: string };

export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AgentToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface AgentToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export type AgentStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_calls"; calls: AgentToolCall[] }
  | { type: "done"; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } };

export interface AgentRoundInput {
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignalLike;
}

export interface AgentChatProvider {
  readonly providerName: string;
  readonly modelName: string;
  /** Streams one round. Emits text deltas, then at most one `tool_calls`, then `done`. */
  streamRound(input: AgentRoundInput, onEvent: (event: AgentStreamEvent) => Promise<void> | void): Promise<void>;
}
