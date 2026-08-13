import { parseCardRecordId } from "@lf/core/types/cardRecord.js";
import type { EmbeddingProvider } from "@lf/core/ports/ai/EmbeddingProvider.js";
import type { PrismaRecallRepository, RecallReason } from "../../infrastructure/repository/PrismaRecallRepository.js";
import type { CardRelationService } from "./CardRelationService.js";
import type { CardImageService } from "./CardImageService.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";

const LAUNCH_MODES = new Set(["recommended", "shuffle", "search", "collection", "time", "card_detail"]);

export class RecallService {
  constructor(
    private readonly repository: PrismaRecallRepository,
    private readonly relations: CardRelationService,
    private readonly embeddingProvider?: EmbeddingProvider,
    private readonly imageService?: CardImageService,
    private readonly resourceGovernor?: ResourceGovernor,
    private readonly explorationNodeLimit = 12,
    private readonly searchResultLimit = 10,
    private readonly semanticMinScore = 0.60,
  ) {}

  async seedCandidates(userId: string, mode: string, excludedRecordIds: string[], requestedLimit?: number) {
    const normalizedMode = mode === "shuffle" ? "shuffle" : "recommended";
    const excludedSourceIds = excludedRecordIds.flatMap((recordId) => {
      const ref = parseCardRecordId(recordId);
      return ref?.source === "card" ? [ref.sourceId] : [];
    });
    return this.withThumbnails(userId, await this.repository.seedCandidates(userId, normalizedMode, excludedSourceIds, clamp(requestedLimit, 1, 10, 1)));
  }

  async search(userId: string, input: {
    query?: string;
    collectionId?: string;
    timeRange?: string;
    limit?: number;
    semanticEnabled?: boolean;
    consumeSemanticAllowance?: () => Promise<boolean>;
  }) {
    const query = input.query?.trim() ?? "";
    if (query.length > 200) throw recallError("RECALL_SEARCH_INVALID");
    const timeRange = ["recent", "this_year", "last_year", "earlier"].includes(input.timeRange ?? "")
      ? input.timeRange as "recent" | "this_year" | "last_year" | "earlier"
      : undefined;
    const resultLimit = clamp(input.limit, 1, this.searchResultLimit, this.searchResultLimit);
    const searchInput = {
      userId,
      query,
      collectionId: input.collectionId === "unclassified" ? null : input.collectionId?.trim() || undefined,
      timeRange,
      limit: resultLimit,
    };
    const lexical = query
      ? await this.repository.searchCandidates(searchInput)
      : [];
    if (lexical.length >= resultLimit || !query || !this.embeddingProvider || input.semanticEnabled === false) {
      return this.withThumbnails(userId, lexical.slice(0, resultLimit));
    }
    if (input.consumeSemanticAllowance && !await input.consumeSemanticAllowance()) {
      return this.withThumbnails(userId, lexical.slice(0, resultLimit));
    }
    let semantic = [] as Awaited<ReturnType<PrismaRecallRepository["semanticSearchCandidates"]>>;
    try {
      const embed = () => this.embeddingProvider!.embed(query);
      const result = this.resourceGovernor
        ? await this.resourceGovernor.execute("embedding", userId, embed)
        : await embed();
      semantic = await this.repository.semanticSearchCandidates({
        ...searchInput,
        embedding: result.embedding,
        modelVersion: result.modelVersion,
        minScore: this.semanticMinScore,
      });
    } catch {
      // Keyword results remain usable when vector search is unavailable.
    }
    const seen = new Set(lexical.map((candidate) => candidate.recordId));
    const merged = [...lexical];
    for (const candidate of semantic) {
      if (seen.has(candidate.recordId)) continue;
      seen.add(candidate.recordId);
      merged.push(candidate);
      if (merged.length >= resultLimit) break;
    }
    return this.withThumbnails(userId, merged);
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
    return this.withThumbnails(userId, await this.repository.searchCandidates({
      userId,
      query,
      collectionId: input.collectionId === "unclassified" ? null : input.collectionId?.trim() || undefined,
      timeRange,
      limit: clamp(input.limit, 1, 50, 20),
    }));
  }

  private async withThumbnails<T extends { recordId: string }>(userId: string, candidates: T[]): Promise<Array<T & { thumbnail: { url: string; urlExpiresAt: string | null; width: number; height: number } | null }>> {
    if (!candidates.length || !this.imageService) return candidates.map((candidate) => ({ ...candidate, thumbnail: null }));
    const refs = candidates.map((candidate) => parseCardRecordId(candidate.recordId)).filter((ref): ref is NonNullable<typeof ref> => ref?.source === "card");
    const images = await this.repository.findCandidateImages(userId, refs.map((ref) => ref.sourceId));
    return Promise.all(candidates.map(async (candidate) => {
      const ref = parseCardRecordId(candidate.recordId);
      const image = ref?.source === "card" ? images.get(ref.sourceId) : undefined;
      if (!image) return { ...candidate, thumbnail: null };
      try { return { ...candidate, thumbnail: (await this.imageService!.views(image)).thumbnail }; }
      catch { return { ...candidate, thumbnail: null }; }
    }));
  }

  async create(userId: string, input: { seedRecordId: string; launchMode: string; launchContext?: unknown }) {
    if (!LAUNCH_MODES.has(input.launchMode)) throw recallError("RECALL_LAUNCH_MODE_INVALID");
    const launchContext = sanitizeLaunchContext(input.launchContext);
    const dateKey = input.launchMode === "time" ? launchContext?.dateKey : undefined;
    if (input.launchMode === "time" && !isDateKey(dateKey)) throw recallError("RECALL_DATE_INVALID");
    const dateSession = dateKey
      ? await this.repository.createDateSession(userId, dateKey, launchContext)
      : null;
    const sessionId = dateSession?.sessionId
      ?? await this.repository.createSession(userId, input.seedRecordId, input.launchMode, launchContext);
    const session = await this.requireSession(userId, sessionId);
    const seed = session.nodes[0];
    if (seed && input.launchMode !== "time") await this.expand(userId, sessionId, seed.id, 2);
    return this.requireSession(userId, sessionId);
  }

  async createFromRecords(userId: string, input: { recordIds: string[]; query?: string }) {
    const recordIds = input.recordIds.filter((value): value is string => typeof value === "string").slice(0, 50);
    const query = input.query?.trim().slice(0, 200) || undefined;
    const sessionId = await this.repository.createRecordSetSession(userId, recordIds, query ? { query } : undefined);
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
    const related = await this.relations.relations(userId, recordId, clamp(requestedLimit, 1, 20, 2));
    await this.repository.persistExpansion({
      userId,
      sessionId,
      fromNodeId: nodeId,
      relations: related.map((item) => ({ recordId: item.recordId, reasons: item.reasons as RecallReason[] })),
      nodeLimit: Math.max(1, Math.floor(this.explorationNodeLimit)),
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
  const allowed = ["collectionId", "timeRange", "dateKey"];
  const entries = allowed.flatMap((key) => typeof source[key] === "string" ? [[key, String(source[key]).slice(0, 100)] as const] : []);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function isDateKey(value: string | undefined): value is string { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)); }

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value!))) : fallback;
}

function recallError(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}
