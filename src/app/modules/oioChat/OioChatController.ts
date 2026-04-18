import { dateToLocalKey, formatKeyToSlashDisplay } from "../../dateUtils.js";
import { confirmDialog } from "../../shared/confirmDialog";
import { escapeHtml } from "../../shared/html";
import { renderTextWithKeyPhraseHighlight } from "../../shared/keyPhraseHighlight";
import { oioChatConfig } from "../../services/chat/chatConfig";
import { createChatReply, toChatErrorMessage, type ChatReply } from "../../services/chat/chatService";
import { fetchChatUsageSnapshot } from "../../services/chat/chatUsageService";
import { generatePracticeFeedback, generatePracticeQuestion } from "../../services/chat/practiceService";
import {
  pullChatSessions,
  pullMoreChatSessions,
  pushChatPhraseUpdates,
  pushChatSessions,
  type ChatPhraseUpdatePayload,
} from "../../services/cloud/cloudSyncService";
import { getAccessRepository } from "../../infrastructure/repositories";
import { getI18n, t } from "../../i18n/i18n";
import { RewriteApiError } from "../../services/rewrite/rewriteClient";
import { getBrowserTtsService, splitTextForSpeech } from "../../services/tts/browserTtsService";
import { getAuthService } from "../../services/auth/authService";
import { saveTurnToDailyCapture } from "./oioChatCapture";
import { createChatSession, deleteChatSession, listChatSessions, saveChatSession, type OioChatSession } from "./oioChatStore";
import { type ChatTurn, type OioChatMode } from "./oioChatTypes";
import { type CaptureItem } from "../dailyCapture/dailyCaptureStore";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex?: number; results: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export class OioChatController {
  private static readonly MAX_SELECTED_PHRASES_PER_TURN = 3;
  private static readonly PHRASE_SYNC_DEBOUNCE_MS = 3_000;
  private readonly root: HTMLElement | null;
  private readonly historyEl: HTMLElement | null;
  private readonly feedEl: HTMLElement | null;
  private readonly formEl: HTMLFormElement | null;
  private readonly inputEl: HTMLTextAreaElement | null;
  private readonly submitEl: HTMLButtonElement | null;
  private readonly clearEl: HTMLButtonElement | null;
  private readonly voiceInputEl: HTMLButtonElement | null;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly metaEl: HTMLElement | null;
  private readonly statusEl: HTMLElement | null;
  private sessions: OioChatSession[] = [];
  private activeSessionId = "";
  private activeMode: OioChatMode = "beginner";
  private isAdminViewer = false;
  private adminViewerResolved = false;
  private speechRecognition: SpeechRecognitionLike | null = null;
  private speechRecognitionActive = false;
  private speechRecognitionRequested = false;
  private speechRecognitionDraft = "";
  private usageDailyUsed: number | null = null;
  private usageDailyLimit: number | null = null;
  private cloudHasMore = false;
  private cloudNextBefore: string | null = null;
  private loadingMoreHistory = false;
  private pendingSessionIds = new Set<string>();
  private pendingSessionModes = new Map<string, OioChatMode | "practice">();
  private pendingCloudSyncTimer: number | null = null;
  private pendingPhraseUpdates = new Map<string, ChatPhraseUpdatePayload>();
  private phraseAddButtonEl: HTMLButtonElement | null = null;

  constructor({
    root = document.querySelector<HTMLElement>("#tab-panel-oio-chat"),
  }: { root?: HTMLElement | null } = {}) {
    this.root = root;
    this.historyEl = document.querySelector<HTMLElement>("[data-oio-chat-history]");
    this.feedEl = root?.querySelector<HTMLElement>("[data-oio-chat-feed]") ?? null;
    this.formEl = root?.querySelector<HTMLFormElement>("[data-oio-chat-form]") ?? null;
    this.inputEl = root?.querySelector<HTMLTextAreaElement>("[data-oio-chat-input]") ?? null;
    this.submitEl = root?.querySelector<HTMLButtonElement>("[data-oio-chat-submit]") ?? null;
    this.clearEl = root?.querySelector<HTMLButtonElement>("[data-oio-chat-clear]") ?? null;
    this.voiceInputEl = root?.querySelector<HTMLButtonElement>("[data-oio-chat-voice-input]") ?? null;
    this.modeButtons = Array.from(root?.querySelectorAll<HTMLButtonElement>("[data-oio-chat-mode]") ?? []);
    this.metaEl = root?.querySelector<HTMLElement>("[data-oio-chat-meta]") ?? null;
    this.statusEl = root?.querySelector<HTMLElement>("[data-oio-chat-status]") ?? null;
  }

  async init(): Promise<void> {
    if (!this.root || !this.feedEl || !this.inputEl || !this.historyEl) return;

    await this.loadSessions();
    this.renderModeState();
    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.configureSpeechRecognition();
    this.bindEvents();
    getI18n().subscribe(() => {
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      this.updateVoiceInputState();
    });
    this.updateVoiceInputState();
    void this.refreshAdminViewerFlag();
    void this.syncUsageFromServer();
    void this.syncSessionsFromCloud();
  }

  private async syncSessionsFromCloud(): Promise<void> {
    try {
      const result = await pullChatSessions();
      this.cloudHasMore = !!result?.hasMore;
      this.cloudNextBefore = result?.nextBefore ?? null;
      await this.loadSessions();
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      void this.syncUsageFromServer();
    } catch {
      this.cloudHasMore = false;
      this.cloudNextBefore = null;
      // ignore cloud sync failures
    }
  }

  private bindEvents(): void {
    this.inputEl?.addEventListener("input", () => {
      if (!this.inputEl) return;
      if (this.inputEl.value.length > oioChatConfig.maxInputChars) {
        this.inputEl.value = this.inputEl.value.slice(0, oioChatConfig.maxInputChars);
      }
      this.updateMeta();
    });
    this.inputEl?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      void this.sendMessage();
    });

    this.formEl?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.sendMessage();
    });

    this.clearEl?.addEventListener("click", () => {
      if (this.inputEl) this.inputEl.value = "";
      this.setStatus("");
      this.updateMeta();
    });
    this.voiceInputEl?.addEventListener("click", () => {
      this.toggleSpeechInput();
    });

    this.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.activeMode = button.dataset.oioChatMode === "advanced" ? "advanced" : "beginner";
        this.renderModeState();
      });
    });

    this.historyEl?.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement | null;

      const newChatBtn = target?.closest<HTMLButtonElement>("[data-oio-chat-new]");
      if (newChatBtn) {
        await this.startNewSession();
        return;
      }

      const loadMoreBtn = target?.closest<HTMLButtonElement>("[data-chat-history-load-more]");
      if (loadMoreBtn) {
        void this.loadMoreHistoryFromCloud();
        return;
      }

      const sessionBtn = target?.closest<HTMLElement>("[data-chat-session-id]");
      if (sessionBtn) {
        const sessionId = sessionBtn.dataset.chatSessionId?.trim() ?? "";
        if (!sessionId) return;
        if (sessionId !== this.activeSessionId && !(await this.ensurePracticeSessionCanClose())) {
          return;
        }
        this.activeSessionId = sessionId;
        this.renderModeState();
        this.renderHistory();
        this.renderFeed();
        this.updateMeta();
        this.setStatus("");
        return;
      }

      const deleteBtn = target?.closest<HTMLButtonElement>("[data-chat-session-delete]");
      if (deleteBtn) {
        const sessionId = deleteBtn.dataset.chatSessionDelete?.trim() ?? "";
        if (!sessionId) return;
        void this.confirmAndRemoveSession(sessionId);
        return;
      }

    });

    this.root?.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement | null;
      const addPhraseBtn = target?.closest<HTMLButtonElement>("[data-oio-chat-add-phrase]");
      if (addPhraseBtn) {
        event.preventDefault();
        await this.applySelectedPhraseToTurn();
        return;
      }
      const removePhraseBtn = target?.closest<HTMLButtonElement>("[data-oio-chat-remove-phrase]");
      if (removePhraseBtn) {
        const turnId = removePhraseBtn.dataset.oioChatRemovePhraseTurn?.trim() ?? "";
        const encodedPhrase = removePhraseBtn.dataset.oioChatRemovePhrase?.trim() ?? "";
        if (!turnId || !encodedPhrase) return;
        let phrase = "";
        try {
          phrase = decodeURIComponent(encodedPhrase);
        } catch {
          phrase = encodedPhrase;
        }
        await this.removePhraseFromTurn(turnId, phrase);
        return;
      }
      const speakBtn = target?.closest<HTMLButtonElement>("[data-oio-chat-speak]");
      if (speakBtn) {
        const encodedText = speakBtn.dataset.oioChatSpeak?.trim() ?? "";
        await this.playEncodedText(encodedText);
        return;
      }
      const captureBtn = target?.closest<HTMLButtonElement>("[data-refine-turn-id]");
      if (!captureBtn) return;
      const turnId = captureBtn.dataset.refineTurnId?.trim() ?? "";
      if (!turnId) return;
      await this.captureTurn(turnId);
    });
    this.root?.addEventListener("mouseup", () => {
      window.setTimeout(() => {
        this.refreshPhraseAddButton();
      }, 0);
    });
    this.root?.addEventListener("keyup", (event) => {
      if ((event as KeyboardEvent).key !== "Shift") return;
      this.refreshPhraseAddButton();
    });
    document.addEventListener("selectionchange", () => {
      this.refreshPhraseAddButton();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      void this.flushPendingCloudSync();
    });
    window.addEventListener("pagehide", () => {
      void this.flushPendingCloudSync();
    });
    window.addEventListener("beforeunload", () => {
      void this.flushPendingCloudSync();
    });

    document.addEventListener("oio-chat-start-practice", (event) => {
      const detail = (event as CustomEvent<{ item?: CaptureItem }>).detail;
      const item = detail?.item;
      if (!item) return;
      void this.withUiBlock("正在打开练习...", async () => {
        await this.startPracticeSession(item);
      });
    });

    document.addEventListener("app-auth-signed-in", () => {
      void this.syncUsageFromServer();
      void this.syncSessionsFromCloud();
    });
    document.addEventListener("app-before-tab-change", (event) => {
      const detail = (event as CustomEvent<{ toTabId?: string }>).detail;
      if (detail?.toTabId !== "oio-chat") {
        void this.flushPendingCloudSync();
      }
      if (detail?.toTabId === "oio-chat") return;
      const active = this.activeSession;
      if (active?.kind !== "practice") return;
      if (active.practiceCompleted) {
        this.finishActivePracticeSession(false);
        return;
      }
      if (!window.confirm(t("oio_chat.confirm_abandon_practice_message"))) {
        event.preventDefault();
        return;
      }
      this.finishActivePracticeSession(false);
    });
  }

  private async loadSessions(): Promise<void> {
    const sessions = await listChatSessions();
    const emptySessions = sessions.filter((session) => session.turns.length === 0);
    const practiceSessions = sessions.filter((session) => session.kind === "practice");
    const staleSessionIds = Array.from(new Set([...emptySessions, ...practiceSessions].map((session) => session.id)));
    if (staleSessionIds.length) {
      await Promise.all(staleSessionIds.map((sessionId) => deleteChatSession(sessionId)));
    }
    this.sessions = sessions.filter((session) => session.turns.length > 0 && session.kind !== "practice");

    if (!this.activeSessionId || !this.sessions.some((session) => session.id === this.activeSessionId)) {
      this.activeSessionId = this.sessions[0]?.id ?? "";
    }
  }

  private get activeSession(): OioChatSession | null {
    return this.sessions.find((session) => session.id === this.activeSessionId) ?? null;
  }

  private async startNewSession(): Promise<void> {
    if (!(await this.ensurePracticeSessionCanClose())) {
      return;
    }
    const current = this.activeSession;
    if (current && current.turns.length === 0) {
      this.activeSessionId = current.id;
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      this.inputEl?.focus();
      return;
    }

    this.activeSessionId = "";
    if (this.inputEl) this.inputEl.value = "";
    this.setStatus("");
    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.inputEl?.focus();
  }

  private async sendMessage(): Promise<void> {
    if (!this.inputEl || !this.submitEl) return;
    if (this.isActiveSessionPending()) return;
    if (this.activeSession?.kind === "practice" && this.activeSession.practiceCompleted) {
      this.finishActivePracticeSession(true);
      return;
    }

    const cappedInput = this.inputEl.value.slice(0, oioChatConfig.maxInputChars);
    if (cappedInput !== this.inputEl.value) {
      this.inputEl.value = cappedInput;
    }
    const sourceText = cappedInput.trim();
    if (!sourceText) return;
    if (!this.ensureSignedInBeforeChat()) return;

    let session = this.activeSession;
    if (!session) {
      session = createChatSession();
      this.sessions = [session, ...this.sessions];
      this.activeSessionId = session.id;
    }

    const waitingPracticeReply = this.isWaitingPracticeReply(session);

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      sourceText,
      countsTowardLimit: true,
      occurredAt: new Date().toISOString(),
    };

    session.turns.push(userTurn);
    session.updatedAt = new Date().toISOString();
    if (session.title === oioChatConfig.newConversationTitle) {
      session.title = this.buildSessionTitle(sourceText);
    }

    this.inputEl.value = "";
    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.setSessionPending(session.id, true, session.kind === "practice" ? "practice" : this.activeMode);

    try {
      await this.persistSessionSafely(session, false);
      if (waitingPracticeReply) {
        await this.handlePracticeReply(session, sourceText);
      } else {
        const reply = await createChatReply(sourceText, this.activeMode);
        this.applyUsageSnapshot(reply.usageDailyUsed, reply.usageDailyLimit);
        session.turns.push(this.toAssistantTurn(reply));
        session.updatedAt = new Date().toISOString();
        this.setStatus("");
        await this.persistSessionSafely(session, true);
      }
    } catch (error) {
      userTurn.countsTowardLimit = false;
      const adminDebug = await this.buildAdminDebug(error, {
        stage: session.kind === "practice" ? "practice_feedback" : "chat_reply",
        mode: this.activeMode,
      });
      session.turns.push({
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        reply: toChatErrorMessage(error),
        occurredAt: new Date().toISOString(),
        adminDebug,
      });
      session.updatedAt = new Date().toISOString();
      this.setStatus(toChatErrorMessage(error));
      await this.persistSessionSafely(session, true);
      void this.syncUsageFromServer();
    } finally {
      this.setSessionPending(session.id, false);
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      this.feedEl?.scrollTo({ top: this.feedEl.scrollHeight });
    }
  }

  private ensureSignedInBeforeChat(): boolean {
    const authSnapshot = getAuthService().getSnapshot();
    if (authSnapshot.status === "signed_in") return true;

    if (authSnapshot.status === "loading") {
      this.setStatus(t("account.checking_session"));
      return false;
    }
    if (authSnapshot.status === "disabled") {
      this.setStatus(t("oio_chat.login_required_unavailable"));
      return false;
    }

    this.setStatus(t("oio_chat.login_required"));
    void getAuthService().openSignIn();
    return false;
  }

  private toAssistantTurn(reply: ChatReply): ChatTurn {
    return {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      naturalVersion: reply.naturalVersion,
      reply: reply.reply,
      keyPhrases: reply.keyPhrases,
      occurredAt: new Date().toISOString(),
      usageDailyUsed: reply.usageDailyUsed,
      usageDailyLimit: reply.usageDailyLimit,
      proficiencyPhrase: reply.proficiencyHint?.phrase?.trim() || undefined,
      proficiencyDelta: typeof reply.proficiencyHint?.delta === "number" ? reply.proficiencyHint.delta : undefined,
      proficiencyScore: typeof reply.proficiencyHint?.score === "number" ? reply.proficiencyHint.score : undefined,
    };
  }

  private renderHistory(): void {
    if (!this.historyEl) return;
    const historySessions = this.sessions.filter((session) => session.kind !== "practice");
    const header = `
      <div class="oio-chat-history-head">
        <span class="oio-chat-history-head-label">${escapeHtml(t("oio_chat.history_title"))}</span>
        <button type="button" class="secondary oio-chat-history-new-btn" data-oio-chat-new>${escapeHtml(t("oio_chat.new_chat"))}</button>
      </div>
    `;

    const listHtml = historySessions
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => `
        <article class="oio-chat-history-item${session.id === this.activeSessionId ? " is-active" : ""}">
          <button
            type="button"
            class="oio-chat-history-open"
            data-chat-session-id="${escapeHtml(session.id)}"
          >
          <span class="oio-chat-history-copy">
            <strong class="oio-chat-history-title">${escapeHtml(session.title)}</strong>
          </span>
          </button>
          <button type="button" class="oio-chat-history-delete" data-chat-session-delete="${escapeHtml(session.id)}" aria-label="${escapeHtml(t("oio_chat.delete_conversation_aria"))}">×</button>
        </article>
      `)
      .join("");
    const loadMoreHtml = this.cloudHasMore
      ? `
        <div class="oio-chat-history-more">
          <button type="button" class="secondary" data-chat-history-load-more ${this.loadingMoreHistory ? "disabled" : ""}>
            ${escapeHtml(this.loadingMoreHistory ? t("common.loading") : t("oio_chat.history_load_more"))}
          </button>
        </div>
      `
      : "";
    if (!historySessions.length) {
      this.historyEl.innerHTML = header + `<p class="oio-chat-history-empty">${escapeHtml(t("oio_chat.history_empty"))}</p>` + loadMoreHtml;
      return;
    }
    this.historyEl.innerHTML = header + `<div class="oio-chat-history-list">${listHtml}</div>` + loadMoreHtml;
  }

  private async loadMoreHistoryFromCloud(): Promise<void> {
    if (this.loadingMoreHistory) return;
    if (!this.cloudHasMore || !this.cloudNextBefore) return;
    this.loadingMoreHistory = true;
    this.renderHistory();
    try {
      const result = await pullMoreChatSessions(this.cloudNextBefore);
      if (!result) return;
      this.cloudHasMore = result.hasMore;
      this.cloudNextBefore = result.nextBefore;
      await this.loadSessions();
      this.renderFeed();
      this.updateMeta();
    } catch {
      // ignore load-more failures
    } finally {
      this.loadingMoreHistory = false;
      this.renderHistory();
    }
  }

  private renderFeed(): void {
    if (!this.feedEl) return;
    this.hidePhraseAddButton();
    const session = this.activeSession;
    if (!session?.turns.length) {
      this.feedEl.innerHTML = `
        <article class="chat-bubble chat-bubble--assistant">
          <span class="chat-bubble-role">OIO</span>
          <p class="chat-bubble-text">${escapeHtml(t("oio_chat.intro"))}</p>
        </article>
      `;
      return;
    }

    const turnsHtml = session.turns
      .map((turn) => {
        if (turn.role === "user") {
          const userText = (turn.sourceText ?? "").trim();
          return `
            <article class="chat-bubble chat-bubble--user">
              <span class="chat-bubble-role">${escapeHtml(t("oio_chat.you"))}</span>
              <p class="chat-bubble-text">${escapeHtml(userText)}</p>
            </article>
          `;
        }

        const naturalVersion = turn.naturalVersion || "";
        const naturalVersionBlock = naturalVersion
          ? this.renderAssistantSection(t("oio_chat.section_rewritten"), naturalVersion, turn.id, turn.keyPhrases)
          : "";

        const reply = turn.reply || "";
        const replyBlock = turn.practiceKind !== "question" && reply
          ? this.renderAssistantSection(t("oio_chat.section_reply_comment"), reply, turn.id, turn.keyPhrases)
          : "";
        const proficiencyBlock = this.renderProficiencyHint(turn);

        const adminDebugBlock = this.isAdminViewer && turn.adminDebug?.trim()
          ? `
            <div class="chat-assistant-section">
              <span class="chat-assistant-label">${escapeHtml(t("oio_chat.section_admin_debug"))}</span>
              <pre class="chat-assistant-debug">${escapeHtml(turn.adminDebug)}</pre>
            </div>
          `
          : "";

        const keyPhrasesBlock = Array.isArray(turn.keyPhrases) && turn.keyPhrases.length
          ? `<div class="chat-highlight-list">${turn.keyPhrases.map((item) => this.renderPhraseChip(item, turn.id, !turn.capturedAt)).join("")}</div>`
          : "";

        const saveAction = turn.naturalVersion?.trim()
          ? turn.capturedAt
            ? `<button type="button" class="secondary" disabled>${escapeHtml(t("oio_chat.saved_to"))} ${escapeHtml(formatKeyToSlashDisplay(turn.capturedDateKey ?? this.activeSession?.dateKey ?? dateToLocalKey(new Date())))}</button>`
            : `<button type="button" class="secondary" data-refine-turn-id="${escapeHtml(turn.id)}">${escapeHtml(t("oio_chat.save_to_daily_capture"))}</button>`
          : "";
        const actionBlock = saveAction
          ? `<div class="chat-assistant-actions">${saveAction}</div>`
          : "";

        const mainText = turn.practiceKind === "question" && turn.reply?.trim()
          ? this.renderSpeakLines(turn.reply, "chat-bubble-text", turn.id, turn.keyPhrases)
          : "";

        return `
          <article class="chat-bubble chat-bubble--assistant">
            <span class="chat-bubble-role">OIO</span>
            ${mainText}
            ${naturalVersionBlock}
            ${replyBlock}
            ${proficiencyBlock}
            ${adminDebugBlock}
            ${keyPhrasesBlock}
            ${actionBlock}
          </article>
        `;
      })
      .join("");
    const pendingBubble = this.isSessionPending(session.id)
      ? `
        <article class="chat-bubble chat-bubble--assistant chat-bubble--thinking">
          <span class="chat-bubble-role">OIO</span>
          <div class="chat-thinking-row">
            <span class="chat-thinking-spinner" aria-hidden="true"></span>
            <span class="chat-assistant-copy">${escapeHtml(t("oio_chat.thinking"))}</span>
          </div>
        </article>
      `
      : "";
    this.feedEl.innerHTML = turnsHtml + pendingBubble;
  }

  private renderAssistantSection(label: string, text: string, turnId: string, keyPhrases?: string[]): string {
    return `
      <div class="chat-assistant-section">
        <span class="chat-assistant-label">${escapeHtml(label)}</span>
        ${this.renderSpeakParagraph(text, "chat-assistant-copy", turnId, keyPhrases)}
      </div>
    `;
  }

  private renderSpeakParagraph(text: string, textClassName: string, turnId: string, keyPhrases?: string[]): string {
    const content = text.trim();
    if (!content) return "";
    const encoded = escapeHtml(encodeURIComponent(content));
    const highlighted = renderTextWithKeyPhraseHighlight(content, keyPhrases);
    return `
      <div class="chat-speak-line">
        <p class="${textClassName}" data-oio-chat-selectable="1" data-oio-chat-turn-id="${escapeHtml(turnId)}">${highlighted}</p>
        ${this.renderSpeakButton("data-oio-chat-speak", encoded)}
      </div>
    `;
  }

  private renderSpeakLines(text: string, textClassName: string, turnId: string, keyPhrases?: string[]): string {
    const lines = splitTextForSpeech(text);
    if (!lines.length) return "";
    return `
      <div class="chat-speak-lines">
        ${lines
          .map((line) => {
            const encoded = escapeHtml(encodeURIComponent(line));
            const highlighted = renderTextWithKeyPhraseHighlight(line, keyPhrases);
            return `
              <div class="chat-speak-line">
                <p class="${textClassName}" data-oio-chat-selectable="1" data-oio-chat-turn-id="${escapeHtml(turnId)}">${highlighted}</p>
                ${this.renderSpeakButton("data-oio-chat-speak", encoded)}
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  private renderPhraseChip(phrase: string, turnId: string, removable: boolean): string {
    const encoded = escapeHtml(encodeURIComponent(phrase));
    const removeBtn = removable
      ? `
        <button
          type="button"
          class="chat-chip-remove-btn"
          data-oio-chat-remove-phrase="${encoded}"
          data-oio-chat-remove-phrase-turn="${escapeHtml(turnId)}"
          aria-label="${escapeHtml(t("oio_chat.remove_phrase"))}"
          title="${escapeHtml(t("oio_chat.remove_phrase"))}"
        >×</button>
      `
      : "";
    return `
      <span class="chat-highlight-chip">
        <span>${escapeHtml(phrase)}</span>
        ${this.renderSpeakButton("data-oio-chat-speak", encoded, "chat-chip-speak-btn")}
        ${removeBtn}
      </span>
    `;
  }

  private renderSpeakButton(dataAttr: string, encoded: string, className = "chat-speak-btn"): string {
    return `
      <button type="button" class="${className}" ${dataAttr}="${encoded}" aria-label="${escapeHtml(t("oio_chat.play_audio"))}" title="${escapeHtml(t("oio_chat.play_audio"))}">
        <svg viewBox="0 0 24 24" class="chat-speak-icon" aria-hidden="true">
          <path d="M3 10v4h4l5 4V6L7 10H3z" fill="currentColor"></path>
          <path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
          <path d="M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        </svg>
      </button>
    `;
  }

  private async playEncodedText(encodedText: string): Promise<void> {
    if (!encodedText) return;
    let decoded = "";
    try {
      decoded = decodeURIComponent(encodedText);
    } catch {
      decoded = encodedText;
    }
    const played = await getBrowserTtsService().speak(decoded);
    if (!played) {
      this.setStatus(t("oio_chat.voice_playback_unavailable"));
    }
  }

  private configureSpeechRecognition(): void {
    const recognitionCtor = ((window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition);
    if (!recognitionCtor) {
      this.speechRecognition = null;
      return;
    }

    const recognition = new recognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      if (!this.inputEl) return;
      const base = this.speechRecognitionDraft;
      let finalChunk = "";
      let interimChunk = "";
      const start = typeof event.resultIndex === "number" ? event.resultIndex : 0;
      for (let index = start; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() ?? "";
        if (!transcript) continue;
        if (result.isFinal) {
          finalChunk += `${transcript} `;
        } else {
          interimChunk += `${transcript} `;
        }
      }
      if (finalChunk.trim()) {
        this.speechRecognitionDraft = `${base} ${finalChunk}`.trim();
      }
      const merged = `${this.speechRecognitionDraft} ${interimChunk}`.trim();
      this.inputEl.value = merged;
      this.updateMeta();
    };
    recognition.onerror = () => {
      this.speechRecognitionActive = false;
      this.speechRecognitionRequested = false;
      this.updateVoiceInputState();
      this.setStatus(t("oio_chat.voice_input_failed"));
    };
    recognition.onend = () => {
      this.speechRecognitionActive = false;
      this.updateVoiceInputState();
      if (this.speechRecognitionRequested) {
        window.setTimeout(() => {
          void this.startSpeechInput();
        }, 120);
        return;
      }
      this.setStatus(t("oio_chat.voice_input_stopped"));
    };
    this.speechRecognition = recognition;
  }

  private toggleSpeechInput(): void {
    if (!this.speechRecognition) {
      this.setStatus(t("oio_chat.voice_input_unavailable_browser"));
      return;
    }
    if (this.speechRecognitionActive || this.speechRecognitionRequested) {
      this.speechRecognitionRequested = false;
      this.speechRecognition.stop();
      this.speechRecognitionActive = false;
      this.updateVoiceInputState();
      this.setStatus(t("oio_chat.voice_input_stopped"));
      return;
    }
    void this.startSpeechInput();
  }

  private async startSpeechInput(): Promise<void> {
    if (!this.speechRecognition) return;
    try {
      this.speechRecognitionDraft = this.inputEl?.value?.trim() ?? "";
      this.speechRecognitionRequested = true;
      this.speechRecognition.start();
      this.speechRecognitionActive = true;
      this.setStatus(t("oio_chat.listening"));
      this.updateVoiceInputState();
    } catch {
      this.speechRecognitionActive = false;
      this.speechRecognitionRequested = false;
      this.updateVoiceInputState();
      this.setStatus(t("oio_chat.voice_input_start_failed"));
    }
  }

  private updateVoiceInputState(): void {
    if (!this.voiceInputEl) return;
    const supported = !!this.speechRecognition;
    this.voiceInputEl.disabled = !supported;
    this.voiceInputEl.classList.toggle("is-listening", this.speechRecognitionActive);
    this.voiceInputEl.innerHTML = `
      <span class="oio-chat-voice-visual" aria-hidden="true">
        <svg viewBox="0 0 24 24" class="oio-chat-voice-input-icon" aria-hidden="true">
          <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z" fill="currentColor"></path>
          <path d="M6 11a6 6 0 0 0 12 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
          <path d="M12 17v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
          <path d="M9 21h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        </svg>
        <span class="oio-chat-voice-rings"><i></i><i></i><i></i></span>
      </span>
    `;
    this.voiceInputEl.setAttribute(
      "aria-label",
      supported
        ? (this.speechRecognitionActive ? t("oio_chat.voice_input_stop") : t("oio_chat.voice_input_start"))
        : t("oio_chat.voice_input_unavailable"),
    );
    this.voiceInputEl.setAttribute(
      "title",
      supported
        ? (this.speechRecognitionActive ? t("oio_chat.voice_input_stop") : t("oio_chat.voice_input_start"))
        : t("oio_chat.voice_input_unavailable"),
    );
  }

  private renderProficiencyHint(turn: ChatTurn): string {
    const delta = Number.isFinite(turn.proficiencyDelta) ? Number(turn.proficiencyDelta) : 0;
    const phrase = turn.proficiencyPhrase?.trim() ?? "";
    if (!delta || !phrase) return "";
    return `
      <p class="chat-proficiency-hint">
        ${escapeHtml(`${t("oio_chat.proficiency_gain_prefix")}${delta} · ${phrase}`)}
      </p>
    `;
  }

  private normalizePhraseText(value: string): string {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }

  private countPhraseWords(value: string): number {
    return this.normalizePhraseText(value).match(/\b[\w'-]+\b/g)?.length ?? 0;
  }

  private getTurnById(turnId: string): ChatTurn | null {
    const session = this.activeSession;
    if (!session) return null;
    return session.turns.find((turn) => turn.id === turnId && turn.role === "assistant") ?? null;
  }

  private getSelectionCandidate(): { turnId: string; phrase: string; rect: DOMRect } | null {
    if (!this.root) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return null;
    const text = this.normalizePhraseText(selection.toString());
    if (!text) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width <= 0 && rect.height <= 0)) return null;
    const anchorElement = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
    const focusElement = selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode?.parentElement;
    const anchorSelectable = anchorElement?.closest<HTMLElement>("[data-oio-chat-selectable='1']");
    const focusSelectable = focusElement?.closest<HTMLElement>("[data-oio-chat-selectable='1']");
    if (!anchorSelectable || !focusSelectable) return null;
    const turnId = anchorSelectable.dataset.oioChatTurnId?.trim() ?? "";
    if (!turnId || turnId !== (focusSelectable.dataset.oioChatTurnId?.trim() ?? "")) return null;
    if (!this.getTurnById(turnId)) return null;
    return { turnId, phrase: text, rect };
  }

  private ensurePhraseAddButton(): HTMLButtonElement | null {
    if (this.phraseAddButtonEl && document.body.contains(this.phraseAddButtonEl)) {
      return this.phraseAddButtonEl;
    }
    if (!document.body) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "oio-chat-phrase-fab";
    button.dataset.oioChatAddPhrase = "1";
    button.textContent = "+";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.applySelectedPhraseToTurn();
    });
    button.setAttribute("aria-label", t("oio_chat.add_phrase"));
    button.setAttribute("title", t("oio_chat.add_phrase"));
    button.hidden = true;
    document.body.appendChild(button);
    this.phraseAddButtonEl = button;
    return button;
  }

  private hidePhraseAddButton(): void {
    if (!this.phraseAddButtonEl) return;
    this.phraseAddButtonEl.hidden = true;
    delete this.phraseAddButtonEl.dataset.oioChatPhraseText;
    delete this.phraseAddButtonEl.dataset.oioChatTurnId;
  }

  private refreshPhraseAddButton(): void {
    const button = this.ensurePhraseAddButton();
    if (!button) return;
    const candidate = this.getSelectionCandidate();
    if (!candidate) {
      this.hidePhraseAddButton();
      return;
    }
    const turn = this.getTurnById(candidate.turnId);
    if (!turn || turn.capturedAt) {
      this.hidePhraseAddButton();
      return;
    }
    const words = this.countPhraseWords(candidate.phrase);
    if (words < 2 || words > 8) {
      this.hidePhraseAddButton();
      return;
    }
    const existing = Array.isArray(turn.keyPhrases) ? turn.keyPhrases : [];
    if (existing.length >= OioChatController.MAX_SELECTED_PHRASES_PER_TURN) {
      this.hidePhraseAddButton();
      return;
    }
    button.dataset.oioChatPhraseText = candidate.phrase;
    button.dataset.oioChatTurnId = candidate.turnId;
    button.hidden = false;
    const top = Math.max(8, window.scrollY + candidate.rect.top - 40);
    const left = Math.max(8, Math.min(window.scrollX + candidate.rect.left, window.scrollX + window.innerWidth - 44));
    button.style.top = `${top}px`;
    button.style.left = `${left}px`;
    button.setAttribute("aria-label", t("oio_chat.add_phrase"));
    button.setAttribute("title", t("oio_chat.add_phrase"));
  }

  private async applySelectedPhraseToTurn(): Promise<void> {
    const button = this.phraseAddButtonEl;
    const phrase = this.normalizePhraseText(button?.dataset.oioChatPhraseText ?? "");
    const turnId = button?.dataset.oioChatTurnId?.trim() ?? "";
    this.hidePhraseAddButton();
    if (!phrase || !turnId) return;
    const turn = this.getTurnById(turnId);
    const session = this.activeSession;
    if (!session || !turn || turn.capturedAt) return;

    const words = this.countPhraseWords(phrase);
    if (words < 2 || words > 8) {
      this.setStatus(t("oio_chat.phrase_word_limit"));
      return;
    }

    const existing = Array.isArray(turn.keyPhrases) ? turn.keyPhrases : [];
    if (existing.some((item) => item.toLowerCase() === phrase.toLowerCase())) {
      this.setStatus(t("oio_chat.phrase_duplicate"));
      return;
    }
    if (existing.length >= OioChatController.MAX_SELECTED_PHRASES_PER_TURN) {
      this.setStatus(t("oio_chat.phrase_turn_limit"));
      return;
    }
    turn.keyPhrases = [...existing, phrase];
    this.enqueuePhraseUpdate(session.id, turn.id, turn.keyPhrases);
    session.updatedAt = new Date().toISOString();
    await this.persistSessionSafely(session, false);
    this.scheduleDebouncedCloudSync();
    this.renderFeed();
    this.setStatus(t("oio_chat.phrase_added"));
    window.getSelection()?.removeAllRanges();
  }

  private async removePhraseFromTurn(turnId: string, phrase: string): Promise<void> {
    const targetPhrase = this.normalizePhraseText(phrase);
    const session = this.activeSession;
    const turn = this.getTurnById(turnId);
    if (!session || !turn || !targetPhrase || turn.capturedAt) return;
    const existing = Array.isArray(turn.keyPhrases) ? turn.keyPhrases : [];
    const next = existing.filter((item) => item.toLowerCase() !== targetPhrase.toLowerCase());
    if (next.length === existing.length) return;
    turn.keyPhrases = next;
    this.enqueuePhraseUpdate(session.id, turn.id, turn.keyPhrases);
    session.updatedAt = new Date().toISOString();
    await this.persistSessionSafely(session, false);
    this.scheduleDebouncedCloudSync();
    this.renderFeed();
    this.setStatus(t("oio_chat.phrase_removed"));
  }

  private scheduleDebouncedCloudSync(): void {
    if (this.pendingCloudSyncTimer !== null) {
      window.clearTimeout(this.pendingCloudSyncTimer);
    }
    this.pendingCloudSyncTimer = window.setTimeout(() => {
      this.pendingCloudSyncTimer = null;
      void this.flushPendingCloudSync();
    }, OioChatController.PHRASE_SYNC_DEBOUNCE_MS);
  }

  private async flushPendingCloudSync(): Promise<void> {
    if (this.pendingCloudSyncTimer !== null) {
      window.clearTimeout(this.pendingCloudSyncTimer);
      this.pendingCloudSyncTimer = null;
    }
    const pendingEntries = Array.from(this.pendingPhraseUpdates.entries());
    if (!pendingEntries.length) return;

    const payload = pendingEntries.map(([, update]) => ({
      sessionId: update.sessionId,
      turnId: update.turnId,
      keyPhrases: [...update.keyPhrases],
    }));
    const synced = await pushChatPhraseUpdates(payload);
    if (!synced) return;

    for (const [key, snapshot] of pendingEntries) {
      const current = this.pendingPhraseUpdates.get(key);
      if (!current) continue;
      if (
        current.sessionId === snapshot.sessionId
        && current.turnId === snapshot.turnId
        && this.arePhraseArraysEqual(current.keyPhrases, snapshot.keyPhrases)
      ) {
        this.pendingPhraseUpdates.delete(key);
      }
    }
  }

  private enqueuePhraseUpdate(sessionId: string, turnId: string, keyPhrases?: string[]): void {
    const normalizedSessionId = sessionId.trim();
    const normalizedTurnId = turnId.trim();
    if (!normalizedSessionId || !normalizedTurnId) return;
    const normalizedPhrases = Array.isArray(keyPhrases) ? [...keyPhrases] : [];
    this.pendingPhraseUpdates.set(
      `${normalizedSessionId}::${normalizedTurnId}`,
      {
        sessionId: normalizedSessionId,
        turnId: normalizedTurnId,
        keyPhrases: normalizedPhrases,
      },
    );
  }

  private arePhraseArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  private async captureTurn(turnId: string): Promise<void> {
    const session = this.activeSession;
    if (!session) return;

    const turnIndex = session.turns.findIndex((item) => item.id === turnId && item.role === "assistant");
    const turn = turnIndex >= 0 ? session.turns[turnIndex] : null;
    const hasNaturalVersion = !!turn?.naturalVersion?.trim();
    if (!turn || !hasNaturalVersion || turn.capturedAt) return;
    const sourceText = this.findNearestUserSourceText(session, turnIndex);
    if (!sourceText) return;

    await this.flushPendingCloudSync();
    const result = await saveTurnToDailyCapture(turn, session.id, sourceText, session.dateKey);
    turn.capturedAt = new Date().toISOString();
    turn.capturedDateKey = session.dateKey;
    session.updatedAt = new Date().toISOString();
    await this.persistSession(session);
    this.renderFeed();
    this.renderHistory();
    this.setStatus(
      result === "duplicate"
        ? t("oio_chat.already_saved_for_date")
        : `${t("oio_chat.saved_to")} ${formatKeyToSlashDisplay(session.dateKey)}.`,
    );
  }

  private findNearestUserSourceText(session: OioChatSession, assistantTurnIndex: number): string {
    for (let index = assistantTurnIndex - 1; index >= 0; index -= 1) {
      const turn = session.turns[index];
      if (turn.role !== "user") continue;
      const sourceText = (turn.sourceText ?? "").trim();
      if (sourceText) return sourceText;
    }
    return "";
  }

  private updateMeta(): void {
    if (!this.metaEl || !this.inputEl) return;
    const used = this.usageDailyUsed;
    const limit = this.usageDailyLimit;
    const usedText = used === null ? "--" : String(used);
    const limitText = limit === null ? "--" : String(limit);
    const usageText = `${usedText}/${limitText} ${t("oio_chat.today_usage_chars")}`;
    this.metaEl.textContent = `${this.inputEl.value.length}/${oioChatConfig.maxInputChars} ${t("oio_chat.characters")} · ${usageText}`;
  }

  private renderModeState(): void {
    const isPractice = this.activeSession?.kind === "practice";
    this.root?.classList.toggle("is-practice-session", isPractice);
    this.modeButtons.forEach((button) => {
      button.textContent = button.dataset.oioChatMode === "advanced"
        ? t("oio_chat.mode_advanced")
        : t("oio_chat.mode_beginner");
      const selected = (button.dataset.oioChatMode === "advanced" ? "advanced" : "beginner") === this.activeMode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.disabled = isPractice;
    });

    if (!this.inputEl) return;
    if (isPractice) {
      this.inputEl.placeholder = this.activeSession?.practiceCompleted
        ? t("oio_chat.practice_placeholder_done")
        : t("oio_chat.practice_placeholder_once");
      this.updateComposerPendingState();
      return;
    }
    this.inputEl.placeholder = this.activeMode === "advanced"
      ? t("oio_chat.advanced_placeholder")
      : t("oio_chat.beginner_placeholder");
    this.updateComposerPendingState();
  }

  private isSessionPending(sessionId: string): boolean {
    return this.pendingSessionIds.has(sessionId);
  }

  private isActiveSessionPending(): boolean {
    return !!this.activeSessionId && this.pendingSessionIds.has(this.activeSessionId);
  }

  private setSessionPending(sessionId: string, pending: boolean, pendingMode?: OioChatMode | "practice"): void {
    if (!sessionId) return;
    if (pending) {
      this.pendingSessionIds.add(sessionId);
      this.pendingSessionModes.set(sessionId, pendingMode ?? "beginner");
    } else {
      this.pendingSessionIds.delete(sessionId);
      this.pendingSessionModes.delete(sessionId);
    }
    if (this.activeSessionId === sessionId) {
      this.updateComposerPendingState();
      this.renderFeed();
      this.updateMeta();
    }
    if (pending && this.speechRecognitionActive && this.activeSessionId === sessionId) {
      this.speechRecognitionRequested = false;
      this.speechRecognition?.stop();
      this.speechRecognitionActive = false;
    }
    this.updateVoiceInputState();
  }

  private updateComposerPendingState(): void {
    const isPending = this.isActiveSessionPending();
    const active = this.activeSession;
    const isPracticeCompleted = !!(active?.kind === "practice" && active.practiceCompleted);
    if (this.inputEl) {
      this.inputEl.disabled = isPracticeCompleted || isPending;
    }
    if (this.submitEl) {
      this.submitEl.disabled = isPending;
      this.submitEl.textContent = isPracticeCompleted ? t("oio_chat.finish_practice") : isPending ? t("oio_chat.thinking") : t("oio_chat.send");
    }
    if (isPending && active?.id) {
      const pendingMode = this.pendingSessionModes.get(active.id);
      this.setStatus(
        pendingMode === "advanced"
          ? t("oio_chat.working_advanced")
          : t("oio_chat.working_beginner"),
      );
      return;
    }
    const currentStatus = this.statusEl?.textContent ?? "";
    if (currentStatus === t("oio_chat.working_advanced") || currentStatus === t("oio_chat.working_beginner")) {
      this.setStatus("");
    }
  }

  private setStatus(message: string): void {
    if (this.statusEl) {
      this.statusEl.textContent = message;
    }
  }

  private async withUiBlock(message: string, work: () => Promise<void>): Promise<void> {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      document.dispatchEvent(new CustomEvent("app-unblock-ui"));
    };
    const timer = window.setTimeout(release, 8_000);
    document.dispatchEvent(new CustomEvent("app-block-ui", { detail: { message } }));
    try {
      await work();
    } finally {
      window.clearTimeout(timer);
      release();
    }
  }

  private async startPracticeSession(item: CaptureItem): Promise<void> {
    if (!(await this.ensurePracticeSessionCanClose())) {
      return;
    }
    const contextText = (item.naturalVersion || item.sourceText || "").trim();
    const targetPhrase = (Array.isArray(item.keyPhrases) ? item.keyPhrases[0] : "").trim();
    if (!contextText) {
      this.setStatus(t("oio_chat.practice_context_missing"));
      return;
    }
    if (!targetPhrase) {
      this.setStatus(t("oio_chat.practice_target_missing"));
      return;
    }
    await this.openPracticeSession({
      itemId: item.id,
      contextText,
      targetPhrase,
      referenceAnswer: item.reply?.trim() ?? "",
      titleSeed: contextText,
      entry: "card",
    });
  }

  private async openPracticeSession({
    itemId,
    contextText,
    targetPhrase,
    referenceAnswer,
    titleSeed,
    entry,
  }: {
    itemId: string;
    contextText: string;
    targetPhrase: string;
    referenceAnswer?: string;
    titleSeed: string;
    entry: "card" | "inline";
  }): Promise<void> {
    const session = entry === "card"
      ? (() => {
        const created = createChatSession();
        created.kind = "practice";
        created.practice = {
          itemId,
          question: "",
          targetPhrase,
          referenceAnswer: referenceAnswer?.trim() || undefined,
          attempt: 0,
        };
        created.title = `${t("oio_chat.practice_title_prefix")}: ${this.buildSessionTitle(titleSeed)}`;
        return created;
      })()
      : this.activeSession;
    if (!session) return;

    if (entry === "inline") {
      session.practice = {
        itemId,
        question: "",
        targetPhrase,
        referenceAnswer: referenceAnswer?.trim() || undefined,
        attempt: 0,
      };
      session.practiceCompleted = false;
    } else {
      this.sessions = [session, ...this.sessions];
      this.activeSessionId = session.id;
      this.activeMode = "beginner";
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
    }

    this.setSessionPending(session.id, true, "practice");
    await this.persistSessionSafely(session, true);

    let questionResult: Awaited<ReturnType<typeof generatePracticeQuestion>>;
    try {
      questionResult = await generatePracticeQuestion({ contextText, targetPhrase });
    } catch (error) {
      this.setSessionPending(session.id, false);
      if (entry === "inline") {
        session.practice = undefined;
        session.practiceCompleted = undefined;
        session.updatedAt = new Date().toISOString();
        await this.persistSessionSafely(session, true);
      } else {
        this.discardPracticeSessionById(session.id);
      }
      this.setStatus(toChatErrorMessage(error));
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      return;
    }
    this.applyUsageSnapshot(questionResult.usageDailyUsed, questionResult.usageDailyLimit);
    const question = questionResult.question.trim();
    if (!question) {
      this.setSessionPending(session.id, false);
      this.setStatus(t("oio_chat.reply_failed"));
      return;
    }

    session.practice = {
      ...(session.practice ?? {
        itemId,
        targetPhrase,
        referenceAnswer: referenceAnswer?.trim() || undefined,
        attempt: 0,
      }),
      question,
    };
    session.turns.push({
      id: `assistant-question-${Date.now()}`,
      role: "assistant",
      reply: question,
      keyPhrases: [targetPhrase],
      practiceKind: "question",
      occurredAt: new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();
    this.setSessionPending(session.id, false);
    this.setStatus("");
    await this.persistSessionSafely(session, true);
    this.renderModeState();
    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.inputEl?.focus();
  }

  private async handlePracticeReply(session: OioChatSession, answer: string): Promise<void> {
    const question = session.practice?.question ?? session.turns.find((turn) => turn.practiceKind === "question")?.reply ?? "";
    const targetPhrase = session.practice?.targetPhrase?.trim()
      || (session.turns.find((turn) => turn.practiceKind === "question")?.keyPhrases?.[0] ?? "").trim();
    const referenceAnswer = session.practice?.referenceAnswer ?? "";
    const feedbackResult = await generatePracticeFeedback({ question, answer, targetPhrase, referenceAnswer });
    this.applyUsageSnapshot(feedbackResult.usageDailyUsed, feedbackResult.usageDailyLimit);
    session.turns.push({
      id: `assistant-feedback-${Date.now()}`,
      role: "assistant",
      naturalVersion: feedbackResult.rewrittenAnswer,
      reply: feedbackResult.feedback,
      usageDailyUsed: feedbackResult.usageDailyUsed,
      usageDailyLimit: feedbackResult.usageDailyLimit,
      practiceKind: "feedback",
      occurredAt: new Date().toISOString(),
      proficiencyPhrase: feedbackResult.proficiencyHint?.phrase?.trim() || undefined,
      proficiencyDelta: typeof feedbackResult.proficiencyHint?.delta === "number" ? feedbackResult.proficiencyHint.delta : undefined,
      proficiencyScore: typeof feedbackResult.proficiencyHint?.score === "number" ? feedbackResult.proficiencyHint.score : undefined,
    });
    if (session.practice) {
      session.practice.attempt = (session.practice.attempt ?? 0) + 1;
    }
    session.practiceCompleted = true;
    if (session.kind !== "practice") {
      session.practice = undefined;
      session.practiceCompleted = undefined;
    }
    session.updatedAt = new Date().toISOString();
    this.setStatus(t("oio_chat.practice_complete"));
    await this.persistSessionSafely(session, true);
    this.renderModeState();
  }

  private isWaitingPracticeReply(session: OioChatSession): boolean {
    if (!session.practice || session.practiceCompleted) return false;
    const latestAssistant = [...session.turns].reverse().find((turn) => turn.role === "assistant");
    return latestAssistant?.practiceKind === "question";
  }

  private async persistSession(session: OioChatSession, pushCloud = true): Promise<void> {
    if (session.kind === "practice") {
      return;
    }
    await saveChatSession(session);
    this.sessions = (await listChatSessions()).filter((item) => item.turns.length > 0 && item.kind !== "practice");
    if (!this.sessions.some((item) => item.id === this.activeSessionId) && this.sessions[0]) {
      this.activeSessionId = this.sessions[0].id;
    }
    if (pushCloud) {
      void pushChatSessions(this.sessions.filter((item) => item.kind !== "practice"));
    }
  }

  private async persistSessionSafely(session: OioChatSession, pushCloud = true): Promise<void> {
    try {
      await this.persistSession(session, pushCloud);
    } catch (error) {
      console.error("[oio-chat] Failed to persist session:", error);
      this.setStatus(t("oio_chat.persist_failed"));
    }
  }

  private async confirmAndRemoveSession(sessionId: string): Promise<void> {
    const confirmed = await confirmDialog({
      title: t("oio_chat.confirm_delete_title"),
      message: t("oio_chat.confirm_delete_message"),
      confirmText: t("oio_chat.delete"),
      cancelText: t("oio_chat.cancel"),
    });
    if (!confirmed) return;
    await this.removeSession(sessionId);
  }

  private async refreshAdminViewerFlag(): Promise<void> {
    try {
      const access = await getAccessRepository().getViewerAccess();
      this.isAdminViewer = !!access.profile?.isAdmin;
    } catch {
      this.isAdminViewer = false;
    } finally {
      this.adminViewerResolved = true;
      this.renderFeed();
    }
  }

  private async buildAdminDebug(
    error: unknown,
    context: { stage: "chat_reply" | "practice_feedback"; mode: OioChatMode },
  ): Promise<string | undefined> {
    if (!this.adminViewerResolved) {
      await this.refreshAdminViewerFlag();
    }
    if (!this.isAdminViewer) return undefined;

    const lines = [
      `time=${new Date().toISOString()}`,
      `stage=${context.stage}`,
      `mode=${context.mode}`,
      `error_type=${error instanceof Error ? error.name : typeof error}`,
    ];

    if (error instanceof RewriteApiError) {
      lines.push(`error_code=${error.code}`);
      lines.push(`error_message=${error.message}`);
      return lines.join("\n");
    }

    if (error instanceof Error) {
      lines.push(`error_message=${error.message}`);
      return lines.join("\n");
    }

    lines.push(`error_value=${String(error)}`);
    return lines.join("\n");
  }

  private async removeSession(sessionId: string): Promise<void> {
    const target = this.sessions.find((session) => session.id === sessionId);
    if (target?.kind === "practice") {
      this.discardPracticeSessionById(sessionId);
      this.renderModeState();
      this.renderHistory();
      this.renderFeed();
      this.updateMeta();
      this.setStatus("");
      return;
    }
    await deleteChatSession(sessionId);
    this.sessions = (await listChatSessions()).filter((session) => session.turns.length > 0 && session.kind !== "practice");

    if (!this.sessions.length) {
      this.activeSessionId = "";
    } else if (this.activeSessionId === sessionId || !this.sessions.some((item) => item.id === this.activeSessionId)) {
      this.activeSessionId = this.sessions[0].id;
    }

    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.setStatus("");
    void pushChatSessions(this.sessions.filter((item) => item.kind !== "practice"));
  }

  private async ensurePracticeSessionCanClose(): Promise<boolean> {
    const active = this.activeSession;
    if (active?.kind !== "practice") return true;
    if (active.practiceCompleted) {
      this.finishActivePracticeSession(false);
      return true;
    }
    const confirmed = await confirmDialog({
      title: t("oio_chat.confirm_abandon_practice_title"),
      message: t("oio_chat.confirm_abandon_practice_message"),
      confirmText: t("oio_chat.confirm_abandon_practice_confirm"),
      cancelText: t("oio_chat.confirm_abandon_practice_cancel"),
    });
    if (!confirmed) return false;
    this.finishActivePracticeSession(false);
    return true;
  }

  private discardActivePracticeSession(): void {
    const active = this.activeSession;
    if (active?.kind !== "practice") return;
    this.discardPracticeSessionById(active.id);
  }

  private discardPracticeSessionById(sessionId: string): void {
    this.sessions = this.sessions.filter((session) => session.id !== sessionId);
    if (!this.sessions.length) {
      this.activeSessionId = "";
      return;
    }
    if (this.activeSessionId === sessionId || !this.sessions.some((item) => item.id === this.activeSessionId)) {
      this.activeSessionId = this.sessions[0].id;
    }
  }

  private finishActivePracticeSession(showStatus: boolean): void {
    if (this.activeSession?.kind !== "practice") return;
    this.discardActivePracticeSession();
    if (this.inputEl) this.inputEl.value = "";
    this.renderModeState();
    this.renderHistory();
    this.renderFeed();
    this.updateMeta();
    this.setStatus(showStatus ? t("oio_chat.practice_complete") : "");
  }

  private buildSessionTitle(text: string): string {
    const compact = text.trim().replace(/\s+/g, " ");
    return compact.length > 42 ? `${compact.slice(0, 42)}...` : compact;
  }

  private applyUsageSnapshot(used?: number, limit?: number): void {
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      this.usageDailyLimit = limit;
    }
    if (typeof used === "number" && Number.isFinite(used) && used >= 0) {
      this.usageDailyUsed = used;
    }
  }

  private async syncUsageFromServer(): Promise<void> {
    try {
      const snapshot = await fetchChatUsageSnapshot();
      if (!snapshot) return;
      this.applyUsageSnapshot(snapshot.used, snapshot.limit);
      this.updateMeta();
    } catch {
      // ignore sync failures and keep current in-memory snapshot
    }
  }
}
