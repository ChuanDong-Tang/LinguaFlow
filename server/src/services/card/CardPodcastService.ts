import { createHash } from "node:crypto";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { CardImageAssetEntity, CardRepository } from "@lf/core/ports/repository/CardRepository.js";
import { buildCardThemePrompt, CARD_THEME_PROMPT_VERSION, parseCardThemeOutput } from "@lf/core/Prompts/cardThemePrompt.js";
import { cardRecordId } from "@lf/core/types/cardRecord.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";

type ImageViews = { views(image: CardImageAssetEntity): Promise<{ thumbnail: { url: string } }> };

export type PodcastTheme = { label: string; recordIds: string[]; coverUrl: string | null };
export type PodcastFolder = { id: string; cardCount: number; coverUrl: string | null };

const THEME_SOURCE_LIMIT = 300;
const MIN_CARDS_FOR_THEMES = 6;
/** Regenerate after this many new memories, or when the snapshot is this old. */
const REGENERATE_AFTER_NEW_CARDS = 5;
const REGENERATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Podcast home data: folder covers and AI-grouped themes. Themes are cached per
 * user and regenerated only after enough new memories, so opening the podcast
 * tab is cheap; failures fall back to the last good snapshot.
 */
export class CardPodcastService {
  private readonly inflight = new Map<string, Promise<PodcastTheme[]>>();

  constructor(
    private readonly repository: CardRepository,
    private readonly aiProvider: AIProvider | null,
    private readonly imageService?: ImageViews,
    private readonly contentSafetyService?: ContentSafetyService,
  ) {}

  async folders(userId: string): Promise<PodcastFolder[]> {
    const stats = await this.repository.collectionPodcastStats(userId);
    return Promise.all(stats.map(async (stat) => ({
      id: stat.collectionId,
      cardCount: stat.cardCount,
      coverUrl: await this.coverUrl(stat.cover),
    })));
  }

  async setFolderCover(userId: string, collectionId: string, recordId: string | null): Promise<boolean> {
    const cardId = recordId ? recordId.replace(/^card:/u, "") : null;
    return this.repository.setCollectionCover(userId, collectionId, cardId);
  }

  async themes(userId: string, appLocale?: string | null): Promise<PodcastTheme[]> {
    const running = this.inflight.get(userId);
    if (running) return running;
    const task = this.loadThemes(userId, appLocale).finally(() => this.inflight.delete(userId));
    this.inflight.set(userId, task);
    return task;
  }

  private async loadThemes(userId: string, appLocale?: string | null): Promise<PodcastTheme[]> {
    const sources = await this.repository.listThemeSources(userId, THEME_SOURCE_LIMIT);
    if (sources.length < MIN_CARDS_FOR_THEMES) return [];
    const sourceHash = createHash("sha256").update(sources.map((source) => `${source.id}:${source.text}`).join("\n")).digest("hex");
    const snapshot = await this.repository.getThemeSnapshot(userId);
    const byId = new Map(sources.map((source) => [source.id, source]));
    const fresh = snapshot
      && snapshot.promptVersion === CARD_THEME_PROMPT_VERSION
      && (snapshot.sourceHash === sourceHash
        || (Math.abs(sources.length - snapshot.sourceCount) < REGENERATE_AFTER_NEW_CARDS && Date.now() - snapshot.generatedAt.getTime() < REGENERATE_AFTER_MS));
    let groups = snapshot ? storedGroups(snapshot.themes) : [];
    if (!fresh && this.aiProvider) {
      try {
        groups = await this.generate(userId, sources, appLocale);
        await this.repository.saveThemeSnapshot(userId, { promptVersion: CARD_THEME_PROMPT_VERSION, sourceHash, sourceCount: sources.length, themes: groups });
      } catch {
        // Keep the previous snapshot (possibly empty) when generation fails.
      }
    }
    return Promise.all(groups.map(async (group) => {
      const cardIds = group.cardIds.filter((id) => byId.has(id));
      const cover = cardIds.map((id) => byId.get(id)?.cover).find(Boolean) ?? null;
      return { label: group.label, recordIds: cardIds.map((id) => cardRecordId("card", id)), coverUrl: await this.coverUrl(cover) };
    })).then((themes) => themes.filter((theme) => theme.recordIds.length >= 2));
  }

  private async generate(userId: string, sources: Array<{ id: string; text: string }>, appLocale?: string | null) {
    const prompt = buildCardThemePrompt({ titles: sources.map((source) => source.text), appLocale });
    let output = "";
    await this.aiProvider!.generateChatTextStream({
      userId,
      text: prompt.userPrompt,
      appLocale: appLocale ?? "zh-CN",
      companionMode: "platform_topic",
      systemPrompt: prompt.systemPrompt,
      rawUserPrompt: true,
      maxOutputTokens: 1600,
    }, (event) => { if (event.type === "delta") output += event.text; });
    const themes = parseCardThemeOutput(output, sources.length);
    const labels = themes.map((theme) => theme.label).join("\n");
    if (labels) this.contentSafetyService?.assertAllowed(labels, "output");
    return themes.map((theme) => ({ label: theme.label, cardIds: theme.items.map((index) => sources[index]!.id) }));
  }

  private async coverUrl(image: CardImageAssetEntity | null | undefined): Promise<string | null> {
    if (!image || !this.imageService) return null;
    try { return (await this.imageService.views(image)).thumbnail.url; } catch { return null; }
  }
}

function storedGroups(value: unknown): Array<{ label: string; cardIds: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item?.label === "string" && Array.isArray(item?.cardIds)
    ? [{ label: item.label, cardIds: (item.cardIds as unknown[]).filter((id): id is string => typeof id === "string") }]
    : []);
}
