import type { LegacyMessageRow, PrismaQuickNoteRepository, QuickNoteView } from "../../infrastructure/repository/PrismaQuickNoteRepository.js";
import { formatDateKeyInTimeZone } from "../time/businessClock.js";

export class QuickNoteValidationError extends Error {
  readonly code = "QUICK_NOTE_VALIDATION_FAILED";
}

export class QuickNoteNotFoundError extends Error {
  readonly code = "QUICK_NOTE_NOT_FOUND";
}

export type LegacyQuickNoteView = QuickNoteView & {
  source: "legacy_chat";
  readOnly: true;
};

export class QuickNoteService {
  constructor(private readonly repository: PrismaQuickNoteRepository) {}

  create(userId: string, input: { clientId?: unknown; originalText?: unknown }): Promise<QuickNoteView> {
    const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
    const originalText = typeof input.originalText === "string" ? input.originalText.trim() : "";
    if (!clientId || clientId.length > 100 || !originalText || Array.from(originalText).length > 3000) {
      throw new QuickNoteValidationError("随手记内容无效");
    }
    return this.repository.create(userId, {
      clientId,
      originalText,
      dateKey: formatDateKeyInTimeZone(new Date()),
    });
  }

  async listDay(userId: string, dateKey: unknown): Promise<Array<QuickNoteView | LegacyQuickNoteView>> {
    if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      throw new QuickNoteValidationError("日期无效");
    }
    const [notes, legacyMessages] = await Promise.all([
      this.repository.listDay(userId, dateKey),
      this.repository.listLegacyDay(userId, dateKey),
    ]);
    const materializedLegacyIds = new Set(notes.map((note) => note.legacyMessageId).filter((value): value is string => Boolean(value)));
    const legacy = aggregateLegacyMessages(legacyMessages).filter((note) => !materializedLegacyIds.has(note.id.slice("legacy:".length)));
    return [...notes, ...legacy]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  }

  listDateKeys(userId: string, fromDateKey: unknown, toDateKey: unknown): Promise<string[]> {
    if (typeof fromDateKey !== "string" || typeof toDateKey !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(fromDateKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toDateKey) || fromDateKey > toDateKey) {
      throw new QuickNoteValidationError("日期范围无效");
    }
    return Promise.all([
      this.repository.listDateKeys(userId, fromDateKey, toDateKey),
      this.repository.listLegacyDateKeys(userId, fromDateKey, toDateKey),
    ]).then(([notes, legacy]) => Array.from(new Set([...notes, ...legacy])).sort());
  }

  async updateExpression(userId: string, noteId: string, expressionText: unknown): Promise<QuickNoteView> {
    if (typeof expressionText !== "string" && expressionText !== null) throw new QuickNoteValidationError("表达内容无效");
    const normalized = typeof expressionText === "string" ? expressionText.trim() : null;
    if (normalized && Array.from(normalized).length > 3000) throw new QuickNoteValidationError("表达内容过长");
    const note = await this.repository.updateExpression(userId, noteId, normalized || null);
    if (!note) throw new QuickNoteNotFoundError();
    return note;
  }

  async updateContent(userId: string, noteId: string, input: Record<string, unknown>): Promise<QuickNoteView> {
    const allowed = ["originalText", "expressionText", "translationText", "replyText"] as const;
    const data: { originalText?: string; expressionText?: string | null; translationText?: string | null; replyText?: string | null } = {};
    for (const field of allowed) {
      if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
      const value = input[field];
      if (typeof value !== "string" && (value !== null || field === "originalText")) throw new QuickNoteValidationError("内容无效");
      const normalized = typeof value === "string" ? value.trim() : null;
      if (field === "originalText" && !normalized) throw new QuickNoteValidationError("记录不能为空");
      if (normalized && Array.from(normalized).length > 3000) throw new QuickNoteValidationError("内容过长");
      if (field === "originalText") data.originalText = normalized!;
      else if (field === "expressionText") data.expressionText = normalized || null;
      else if (field === "translationText") data.translationText = normalized || null;
      else data.replyText = normalized || null;
    }
    if (!Object.keys(data).length) throw new QuickNoteValidationError("没有需要更新的内容");
    const note = await this.repository.updateContent(userId, noteId, data);
    if (!note) throw new QuickNoteNotFoundError();
    return note;
  }

  async generate(userId: string, noteId: string, target: unknown, generator: (sourceText: string) => Promise<string>): Promise<QuickNoteView> {
    if (target !== "expression" && target !== "translation" && target !== "reply") {
      throw new QuickNoteValidationError("生成类型无效");
    }
    let current = await this.repository.find(userId, noteId);
    if (!current && noteId.startsWith("legacy:")) {
      current = await this.materializeLegacy(userId, noteId.slice("legacy:".length));
    }
    if (!current) throw new QuickNoteNotFoundError();
    const persistedNoteId = current.id;
    await this.repository.updateGenerationStatus(userId, persistedNoteId, target, "generating");
    try {
      const text = (await generator(current.originalText)).trim();
      const field = target === "expression" ? "expressionText" : target === "translation" ? "translationText" : "replyText";
      const updated = await this.repository.updateContent(userId, persistedNoteId, { [field]: text });
      if (!updated) throw new QuickNoteNotFoundError();
      return updated;
    } catch (error) {
      await this.repository.updateGenerationStatus(userId, persistedNoteId, target, "failed").catch(() => null);
      throw error;
    }
  }

  async addLayer(userId: string, noteId: string, target: unknown): Promise<QuickNoteView> {
    if (target !== "expression" && target !== "translation" && target !== "reply") throw new QuickNoteValidationError("内容类型无效");
    let current = await this.repository.find(userId, noteId);
    if (!current && noteId.startsWith("legacy:")) current = await this.materializeLegacy(userId, noteId.slice("legacy:".length));
    if (!current) throw new QuickNoteNotFoundError();
    const updated = await this.repository.updateGenerationStatus(userId, current.id, target, "added");
    if (!updated) throw new QuickNoteNotFoundError();
    return updated;
  }

  async removeLayer(userId: string, noteId: string, target: unknown): Promise<QuickNoteView> {
    if (target !== "expression" && target !== "translation" && target !== "reply") throw new QuickNoteValidationError("内容类型无效");
    const current = await this.repository.find(userId, noteId);
    if (!current) throw new QuickNoteNotFoundError();
    const field = target === "expression" ? "expressionText" : target === "translation" ? "translationText" : "replyText";
    const updated = await this.repository.updateContent(userId, noteId, { [field]: null });
    if (!updated) throw new QuickNoteNotFoundError();
    return updated;
  }

  async remove(userId: string, noteId: string): Promise<void> {
    if (!await this.repository.remove(userId, noteId)) throw new QuickNoteNotFoundError();
  }

  private async materializeLegacy(userId: string, legacyMessageId: string): Promise<QuickNoteView> {
    const pair = await this.repository.findLegacyPair(userId, legacyMessageId);
    if (!pair) throw new QuickNoteNotFoundError();
    const legacy = toLegacyQuickNote(pair.user, pair.assistant);
    return this.repository.materializeLegacy(userId, {
      legacyMessageId,
      dateKey: legacy.dateKey,
      originalText: legacy.originalText,
      expressionText: legacy.expressionText,
      translationText: legacy.translationText,
      replyText: legacy.replyText,
      createdAt: legacy.createdAt,
    });
  }
}

function aggregateLegacyMessages(rows: LegacyMessageRow[]): LegacyQuickNoteView[] {
  const assistantsBySource = new Map<string, LegacyMessageRow>();
  rows.filter((row) => row.role === "assistant" && row.sourceMessageId).forEach((row) => {
    if (!assistantsBySource.has(row.sourceMessageId!)) assistantsBySource.set(row.sourceMessageId!, row);
  });
  const consumedAssistants = new Set<string>();
  const result: LegacyQuickNoteView[] = [];

  rows.forEach((row, index) => {
    if (row.role !== "user") return;
    let assistant = assistantsBySource.get(row.id) ?? null;
    if (!assistant) {
      for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
        const candidate = rows[cursor];
        if (candidate.conversationId !== row.conversationId) continue;
        if (candidate.role === "user") break;
        if (!consumedAssistants.has(candidate.id)) { assistant = candidate; break; }
      }
    }
    if (assistant) consumedAssistants.add(assistant.id);
    result.push(toLegacyQuickNote(row, assistant));
  });

  rows.filter((row) => row.role === "assistant" && !consumedAssistants.has(row.id)).forEach((assistant) => {
    result.push(toLegacyQuickNote(null, assistant));
  });
  return result;
}

function toLegacyQuickNote(user: LegacyMessageRow | null, assistant: LegacyMessageRow | null): LegacyQuickNoteView {
  const generated = assistant ? parseLegacyAssistantContent(assistant.content, assistant.contactCode) : { expressionText: null, translationText: null, replyText: null };
  const anchor = user ?? assistant!;
  return {
    id: `legacy:${user?.id ?? assistant!.id}`,
    clientId: user?.id ?? assistant!.id,
    legacyMessageId: user?.id ?? assistant!.id,
    dateKey: anchor.conversationDateKey ?? formatDateKeyInTimeZone(anchor.createdAt),
    originalText: user?.content ?? "",
    ...generated,
    expressionStatus: generated.expressionText ? "ready" : "idle",
    translationStatus: generated.translationText ? "ready" : "idle",
    replyStatus: generated.replyText ? "ready" : "idle",
    convertedCardId: null,
    createdAt: anchor.createdAt,
    updatedAt: assistant?.updatedAt ?? anchor.updatedAt,
    source: "legacy_chat",
    readOnly: true,
  };
}

function parseLegacyAssistantContent(content: string, contactCode: string) {
  const read = (names: string[]) => names.map((name) => {
    const match = new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, "i").exec(content);
    return match?.[1]?.trim() ?? "";
  }).find(Boolean) ?? "";
  const hasTags = /<\/?(rewrite|note|en|ja|jp|zh|cn|reply)>/i.test(content);
  const expressionText = read(["rewrite", "en", "ja", "jp"]);
  const translationText = read(["note", "zh", "cn"]);
  const replyText = read(["reply"]);
  if (hasTags) return { expressionText: expressionText || null, translationText: translationText || null, replyText: replyText || null };
  return contactCode === "english_friend"
    ? { expressionText: null, translationText: null, replyText: content.trim() || null }
    : { expressionText: content.trim() || null, translationText: null, replyText: null };
}
