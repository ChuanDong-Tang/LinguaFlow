import { parseCardRecordId } from "@lf/core/types/cardRecord.js";
import type { EmbeddingProvider } from "@lf/core/ports/ai/EmbeddingProvider.js";
import type { PrismaRecallRepository, RecallReason } from "../../infrastructure/repository/PrismaRecallRepository.js";
import type { CardRelationService } from "./CardRelationService.js";

const LAUNCH_MODES = new Set(["recommended", "shuffle", "search", "collection", "time", "card_detail"]);
const NODE_LIMIT = 12;

export class RecallService {
  constructor(
    private readonly repository: PrismaRecallRepository,
    private readonly relations: CardRelationService,
    private readonly embeddingProvider?: EmbeddingProvider,
  ) {}

  async seedCandidates(userId: string, mode: string, excludedRecordIds: string[], requestedLimit?: number) {
    const normalizedMode = mode === "shuffle" ? "shuffle" : "recommended";
    const excludedSourceIds = excludedRecordIds.flatMap((recordId) => {
      const ref = parseCardRecordId(recordId);
      return ref?.source === "card" ? [ref.sourceId] : [];
    });
    return this.repository.seedCandidates(userId, normalizedMode, excludedSourceIds, clamp(requestedLimit, 1, 10, 1));
  }

  async search(userId: string, input: {
    query?: string;
    collectionId?: string;
    timeRange?: string;
    limit?: number;
    semanticEnabled?: boolean;
  }) {
    const query = input.query?.trim() ?? "";
    if (query.length > 200) throw recallError("RECALL_SEARCH_INVALID");
    const timeRange = ["recent", "this_year", "last_year", "earlier"].includes(input.timeRange ?? "")
      ? input.timeRange as "recent" | "this_year" | "last_year" | "earlier"
      : undefined;
    const searchInput = {
      userId,
      query,
      collectionId: input.collectionId === "unclassified" ? null : input.collectionId?.trim() || undefined,
      timeRange,
      limit: clamp(input.limit, 1, 50, 20),
    };
    if (query && this.embeddingProvider && input.semanticEnabled !== false) {
      try {
        const result = await this.embeddingProvider.embed(query);
        const semantic = await this.repository.semanticSearchCandidates({
          ...searchInput,
          embedding: result.embedding,
          modelVersion: result.modelVersion,
        });
        if (semantic.length) return semantic;
      } catch {
        // Exploration search remains usable through lexical matching when vector search is unavailable.
      }
    }
    return this.repository.searchCandidates(searchInput);
  }

  async lexicalSearch(userId: string, input: {
    query?: string;
    collectionId?: string;
    timeRange?: string;
    limit?: number;
  }) {
    const query = input.query?.trim() ?? "";
    if (!query || query.length > 100) throw recallError("CARD_SEARCH_INVALID");
    const timeRange = ["recent", "this_year", "last_year", "earlier"].includes(input.timeRange ?? "")
      ? input.timeRange as "recent" | "this_year" | "last_year" | "earlier"
      : undefined;
    return this.repository.searchCandidates({
      userId,
      query,
      collectionId: input.collectionId === "unclassified" ? null : input.collectionId?.trim() || undefined,
      timeRange,
      limit: clamp(input.limit, 1, 50, 20),
    });
  }

  async create(userId: string, input: { seedRecordId: string; launchMode: string; launchContext?: unknown }) {
    if (!LAUNCH_MODES.has(input.launchMode)) throw recallError("RECALL_LAUNCH_MODE_INVALID");
    const sessionId = await this.repository.createSession(
      userId,
      input.seedRecordId,
      input.launchMode,
      sanitizeLaunchContext(input.launchContext),
    );
    const session = await this.requireSession(userId, sessionId);
    const seed = session.nodes[0];
    if (seed) await this.expand(userId, sessionId, seed.id, 4);
    return this.requireSession(userId, sessionId);
  }

  async active(userId: string) {
    return this.repository.getActiveSession(userId);
  }

  async get(userId: string, sessionId: string) {
    return this.requireSession(userId, sessionId);
  }

  async expand(userId: string, sessionId: string, nodeId: string, requestedLimit?: number) {
    const recordId = await this.repository.nodeRecordId(userId, sessionId, nodeId);
    if (!recordId) throw recallError("RECALL_NODE_NOT_FOUND");
    const related = await this.relations.relations(userId, recordId, clamp(requestedLimit, 1, 20, 4));
    await this.repository.persistExpansion({
      userId,
      sessionId,
      fromNodeId: nodeId,
      relations: related.map((item) => ({ recordId: item.recordId, reasons: item.reasons as RecallReason[] })),
      nodeLimit: NODE_LIMIT,
    });
    return this.requireSession(userId, sessionId);
  }

  async updateNode(userId: string, sessionId: string, nodeId: string, state: string) {
    if (state !== "unvisited" && state !== "current" && state !== "completed") throw recallError("RECALL_NODE_STATE_INVALID");
    if (!await this.repository.updateNode(userId, sessionId, nodeId, state)) throw recallError("RECALL_NODE_NOT_FOUND");
    return this.requireSession(userId, sessionId);
  }

  async finish(userId: string, sessionId: string): Promise<void> {
    if (!await this.repository.finish(userId, sessionId)) throw recallError("RECALL_SESSION_NOT_FOUND");
  }

  private async requireSession(userId: string, sessionId: string) {
    const session = await this.repository.getSession(userId, sessionId);
    if (!session) throw recallError("RECALL_SESSION_NOT_FOUND");
    return session;
  }
}

function sanitizeLaunchContext(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const allowed = ["collectionId", "timeRange"];
  const entries = allowed.flatMap((key) => typeof source[key] === "string" ? [[key, String(source[key]).slice(0, 100)] as const] : []);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value!))) : fallback;
}

function recallError(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}
