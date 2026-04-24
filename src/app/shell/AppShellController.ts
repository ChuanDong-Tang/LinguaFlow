import { getAppTabs, DEFAULT_TAB_ID, isTabDisabled, type AppTabId } from "./appShellConfig";
import { getAccessRepository } from "../infrastructure/repositories";
import { getAuthService, type AuthSnapshot } from "../services/auth/authService";
import { getI18n, t, type Locale } from "../i18n/i18n";
import {
  TTS_DEBUG_EVENT,
  type TtsDebugEventDetail,
} from "../services/audio/providers/ttsDebug";
import {
  getSelectedKokoroVoiceId,
  listKokoroVoiceIds,
  setSelectedKokoroVoiceId,
} from "../services/audio/providers/ttsPreferences";
import { getAudioFacade } from "../services/audio/audioFacade";

const KOKORO_SWITCH_TIMEOUT_MS = 45_000;
const KOKORO_SWITCH_TIMEOUT_SECONDS = Math.floor(KOKORO_SWITCH_TIMEOUT_MS / 1000);
const UI_BLOCK_SAFETY_TIMEOUT_MS = 60_000;
type TtsVoiceGroupId = "uk" | "us";

const TTS_VOICE_META: Record<string, { group: TtsVoiceGroupId; label: string; genderKey: "tts.voice_gender.male" | "tts.voice_gender.female" }> = {
  bm_fable: { group: "uk", label: "Fable", genderKey: "tts.voice_gender.male" },
  bf_emma: { group: "uk", label: "Emma", genderKey: "tts.voice_gender.female" },
  am_echo: { group: "us", label: "Echo", genderKey: "tts.voice_gender.male" },
  af_heart: { group: "us", label: "Heart", genderKey: "tts.voice_gender.female" },
};

const TTS_VOICE_GROUP_ORDER: readonly TtsVoiceGroupId[] = ["uk", "us"] as const;

export class AppShellController {
  private readonly root: Element | null;
  private activeTabId: AppTabId = DEFAULT_TAB_ID;
  private readonly navButtons: HTMLButtonElement[] = [];
  private readonly panels: HTMLElement[] = [];
  private readonly mobileMenuBtn: HTMLButtonElement | null;
  private readonly mobileTitleEl: HTMLElement | null;
  private readonly mobileOverlayEl: HTMLButtonElement | null;
  private readonly oioChatRailEl: HTMLElement | null;
  private readonly authAvatarEl: HTMLElement | null;
  private readonly authLabelEl: HTMLElement | null;
  private readonly authNoteEl: HTMLElement | null;
  private readonly authChipEl: HTMLButtonElement | null;
  private readonly authActionEl: HTMLButtonElement | null;
  private readonly authMenuEl: HTMLElement | null;
  private readonly authMenuSubscriptionEl: HTMLButtonElement | null;
  private readonly authMenuSignOutEl: HTMLButtonElement | null;
  private readonly localeButtons: HTMLButtonElement[] = [];
  private readonly dailyHeroKickerEl: HTMLElement | null;
  private readonly dailyHeroTitleEl: HTMLElement | null;
  private readonly dailyHeroCopyEl: HTMLElement | null;
  private readonly dailyCalendarTitleEl: HTMLElement | null;
  private readonly dailyCalendarNoteEl: HTMLElement | null;
  private readonly dailyLegendHelpBtnEl: HTMLButtonElement | null;
  private readonly dailyLegendLevel1El: HTMLElement | null;
  private readonly dailyLegendLevel2El: HTMLElement | null;
  private readonly dailyLegendLevel3El: HTMLElement | null;
  private readonly superDictHeroKickerEl: HTMLElement | null;
  private readonly superDictHeroTitleEl: HTMLElement | null;
  private readonly superDictHeroCopyEl: HTMLElement | null;
  private readonly ttsSettingsToggleEl: HTMLButtonElement | null;
  private readonly ttsSettingsDialogEl: HTMLDialogElement | null;
  private readonly ttsSettingsCloseEl: HTMLButtonElement | null;
  private readonly ttsSourceOptionEls: HTMLButtonElement[] = [];
  private readonly ttsKokoroOptionsEl: HTMLElement | null;
  private readonly ttsVoiceListEl: HTMLElement | null;
  private readonly ttsSwitchBlockEl: HTMLElement | null;
  private readonly ttsSwitchStatusEl: HTMLElement | null;
  private readonly ttsDebugDialogEl: HTMLDialogElement | null;
  private readonly ttsDebugLogEl: HTMLElement | null;
  private readonly ttsDebugCloseEl: HTMLButtonElement | null;
  private accessRequestId = 0;
  private authMenuOpen = false;
  private ttsSettingsOpen = false;
  private isAdminViewer = false;
  private authPlanKey: "free" | "pro" | null = null;
  private authPlanUserId: string | null = null;
  private lastAuthStatus: AuthSnapshot["status"] | null = null;
  private uiBlockCount = 0;
  private uiBlockSafetyTimer: number | null = null;

  constructor({ root = document.querySelector(".oio-app") }: { root?: Element | null } = {}) {
    this.root = root;
    this.mobileMenuBtn = this.root?.querySelector<HTMLButtonElement>("#app-mobile-menu-btn") ?? null;
    this.mobileTitleEl = this.root?.querySelector<HTMLElement>("#app-mobile-title") ?? null;
    this.mobileOverlayEl = this.root?.querySelector<HTMLButtonElement>("#app-mobile-overlay") ?? null;
    this.oioChatRailEl = this.root?.querySelector<HTMLElement>("[data-oio-chat-rail]") ?? null;
    this.authAvatarEl = this.root?.querySelector<HTMLElement>("[data-auth-avatar]") ?? null;
    this.authLabelEl = this.root?.querySelector<HTMLElement>("[data-auth-label]") ?? null;
    this.authNoteEl = this.root?.querySelector<HTMLElement>("[data-auth-note]") ?? null;
    this.authChipEl = this.root?.querySelector<HTMLButtonElement>("[data-auth-chip]") ?? null;
    this.authActionEl = this.root?.querySelector<HTMLButtonElement>("[data-auth-action]") ?? null;
    this.authMenuEl = this.root?.querySelector<HTMLElement>("[data-auth-menu]") ?? null;
    this.authMenuSubscriptionEl = this.root?.querySelector<HTMLButtonElement>("[data-auth-menu-subscription]") ?? null;
    this.authMenuSignOutEl = this.root?.querySelector<HTMLButtonElement>("[data-auth-menu-signout]") ?? null;
    this.localeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-locale-option]"));
    this.dailyHeroKickerEl = this.root?.querySelector<HTMLElement>("[data-i18n-daily-hero-kicker]") ?? null;
    this.dailyHeroTitleEl = this.root?.querySelector<HTMLElement>("[data-i18n-daily-hero-title]") ?? null;
    this.dailyHeroCopyEl = this.root?.querySelector<HTMLElement>("[data-i18n-daily-hero-copy]") ?? null;
    this.dailyCalendarTitleEl = this.root?.querySelector<HTMLElement>("[data-i18n-daily-calendar-title]") ?? null;
    this.dailyCalendarNoteEl = this.root?.querySelector<HTMLElement>("[data-i18n-daily-calendar-note]") ?? null;
    this.dailyLegendHelpBtnEl = this.root?.querySelector<HTMLButtonElement>("[data-i18n-daily-legend-help-aria]") ?? null;
    this.dailyLegendLevel1El = this.root?.querySelector<HTMLElement>("[data-i18n-daily-legend-level-1]") ?? null;
    this.dailyLegendLevel2El = this.root?.querySelector<HTMLElement>("[data-i18n-daily-legend-level-2]") ?? null;
    this.dailyLegendLevel3El = this.root?.querySelector<HTMLElement>("[data-i18n-daily-legend-level-3]") ?? null;
    this.superDictHeroKickerEl = this.root?.querySelector<HTMLElement>("[data-i18n-super-dict-hero-kicker]") ?? null;
    this.superDictHeroTitleEl = this.root?.querySelector<HTMLElement>("[data-i18n-super-dict-hero-title]") ?? null;
    this.superDictHeroCopyEl = this.root?.querySelector<HTMLElement>("[data-i18n-super-dict-hero-copy]") ?? null;
    this.ttsSettingsToggleEl = this.root?.querySelector<HTMLButtonElement>("[data-tts-settings-toggle]") ?? null;
    this.ttsSettingsDialogEl = document.querySelector<HTMLDialogElement>("[data-tts-settings-dialog]");
    this.ttsSettingsCloseEl = document.querySelector<HTMLButtonElement>("[data-tts-settings-close]");
    this.ttsSourceOptionEls = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tts-source-option]"));
    this.ttsKokoroOptionsEl = document.querySelector<HTMLElement>("[data-tts-kokoro-options]");
    this.ttsVoiceListEl = document.querySelector<HTMLElement>("[data-tts-voice-list]");
    this.ttsSwitchBlockEl = document.querySelector<HTMLElement>("[data-tts-switch-block]");
    this.ttsSwitchStatusEl = document.querySelector<HTMLElement>("[data-tts-switch-status]");
    this.ttsDebugDialogEl = document.querySelector<HTMLDialogElement>("[data-tts-debug-dialog]");
    this.ttsDebugLogEl = document.querySelector<HTMLElement>("[data-tts-debug-log]");
    this.ttsDebugCloseEl = document.querySelector<HTMLButtonElement>("[data-tts-debug-close]");
  }

  async init(): Promise<void> {
    if (!this.root) return;

    this.navButtons.push(...this.root.querySelectorAll<HTMLButtonElement>("[data-tab-target]"));
    this.panels.push(...this.root.querySelectorAll<HTMLElement>("[data-tab-panel]"));

    if (!this.navButtons.length || !this.panels.length) return;

    this.syncDisabledTabs();
    this.applyStaticI18n();
    this.renderTtsVoiceOptions();
    this.wireEvents();
    this.syncTtsSourceOptions();
    this.syncTtsVoiceOptions();
    this.syncTtsKokoroOptionsVisibility();
    this.initLocaleSwitch();
    await this.initAuthPanel();
    const presetTab = this.root.getAttribute("data-active-tab") as AppTabId | null;
    const targetTab = presetTab && !isTabDisabled(presetTab) ? presetTab : this.activeTabId;
    this.setActiveTab(targetTab);
  }

  private wireEvents(): void {
    this.mobileMenuBtn?.addEventListener("click", () => {
      const open = !this.root?.classList.contains("is-mobile-nav-open");
      this.setMobileNavOpen(open);
    });

    this.mobileOverlayEl?.addEventListener("click", () => {
      this.setMobileNavOpen(false);
    });

    this.authActionEl?.addEventListener("click", async () => {
      const authService = getAuthService();
      const snapshot = authService.getSnapshot();
      if (snapshot.status === "signed_in") {
        await authService.signOut();
        return;
      }

      if (snapshot.status !== "disabled") {
        authService.openSignIn();
      }
    });

    this.authChipEl?.addEventListener("click", () => {
      if (this.authChipEl?.disabled) return;
      this.setAuthMenuOpen(!this.authMenuOpen);
    });

    this.authMenuSubscriptionEl?.addEventListener("click", () => {
      this.setAuthMenuOpen(false);
      document.dispatchEvent(
        new CustomEvent("app-open-subscription"),
      );
    });

    this.authMenuSignOutEl?.addEventListener("click", async () => {
      this.setAuthMenuOpen(false);
      await getAuthService().signOut();
    });

    document.addEventListener("click", (event) => {
      const target = event.target as Node | null;
      if (!this.authMenuOpen) return;
      if (!target) return;
      if (this.authMenuEl?.contains(target)) return;
      if (this.authChipEl?.contains(target)) return;
      this.setAuthMenuOpen(false);
    });

    this.ttsSettingsToggleEl?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openTtsSettingsDialog();
    });

    this.ttsSettingsCloseEl?.addEventListener("click", () => {
      this.closeTtsSettingsDialog();
    });

    this.ttsSettingsDialogEl?.addEventListener("cancel", () => {
      this.closeTtsSettingsDialog();
    });

    for (const optionEl of this.ttsSourceOptionEls) {
      optionEl.addEventListener("click", async () => {
        const source = optionEl.dataset.ttsSourceOption?.trim() ?? "";
        if (!source) return;
        if (source === "kokoro") {
          const voiceId = getSelectedKokoroVoiceId();
          let ok = false;
          await this.withTtsSwitchBlock(`正在切换到 Kokoro（${voiceId}）并预热模型（最多 ${KOKORO_SWITCH_TIMEOUT_SECONDS} 秒）...`, async () => {
            ok = await getAudioFacade().switchProvider("kokoro", { warmupTimeoutMs: KOKORO_SWITCH_TIMEOUT_MS });
          });
          if (!ok) {
            window.alert(`Kokoro 初始化失败（超过 ${KOKORO_SWITCH_TIMEOUT_SECONDS} 秒或预热失败），已自动切回 Web Speech。`);
          }
        } else {
          await getAudioFacade().switchProvider("web");
        }
        this.syncTtsSourceOptions();
        this.syncTtsKokoroOptionsVisibility();
      });
    }

    this.ttsVoiceListEl?.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement | null;
      const optionEl = target?.closest<HTMLButtonElement>("[data-tts-voice-option]");
      if (!optionEl) return;
      event.stopPropagation();
      const voiceId = optionEl.dataset.ttsVoiceOption?.trim() ?? "";
      if (!voiceId) return;
      setSelectedKokoroVoiceId(voiceId);
      if (getAudioFacade().getActiveProviderId() === "kokoro") {
        let ok = false;
        await this.withTtsSwitchBlock(`正在切换 Kokoro 音色到 ${voiceId} 并预热模型（最多 ${KOKORO_SWITCH_TIMEOUT_SECONDS} 秒）...`, async () => {
          ok = await getAudioFacade().switchProvider("kokoro", { warmupTimeoutMs: KOKORO_SWITCH_TIMEOUT_MS });
        });
        if (!ok) {
          window.alert(`Kokoro 初始化失败（超过 ${KOKORO_SWITCH_TIMEOUT_SECONDS} 秒或预热失败），已自动切回 Web Speech。`);
        }
      }
      this.syncTtsVoiceOptions();
      this.syncTtsSourceOptions();
      this.syncTtsKokoroOptionsVisibility();
    });

    document.addEventListener("app-request-tab-change", (event) => {
      const detail = (event as CustomEvent<{ tabId?: AppTabId }>).detail;
      const tabId = detail?.tabId;
      if (!tabId) return;
      this.setActiveTab(tabId);
      this.setMobileNavOpen(false);
    });

    document.addEventListener("app-block-ui", (event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      this.showUiBlock(detail?.message || "正在处理中...");
    });
    document.addEventListener("app-unblock-ui", () => {
      this.hideUiBlock();
    });

    this.ttsDebugCloseEl?.addEventListener("click", () => {
      this.ttsDebugDialogEl?.close();
    });
    this.ttsDebugDialogEl?.addEventListener("cancel", () => {
      this.ttsDebugDialogEl?.close();
    });
    document.addEventListener(TTS_DEBUG_EVENT, (event) => {
      const detail = (event as CustomEvent<TtsDebugEventDetail>)?.detail;
      if (!detail || !this.isAdminViewer) return;
      if (detail.level !== "error") return;
      this.appendTtsDebugLog(detail);
      this.openTtsDebugDialog();
    });

    for (const btn of this.navButtons) {
      btn.addEventListener("click", () => {
        const tabId = (btn.dataset.tabTarget as AppTabId | undefined) || DEFAULT_TAB_ID;
        if (isTabDisabled(tabId)) return;
        this.setActiveTab(tabId);
        this.setMobileNavOpen(false);
      });
    }
  }

  private applyStaticI18n(): void {
    if (this.authActionEl) {
      this.authActionEl.textContent = t("account.sign_in");
    }
    if (this.authMenuSubscriptionEl) {
      this.authMenuSubscriptionEl.textContent = t("account.subscription");
    }
    if (this.authMenuSignOutEl) {
      this.authMenuSignOutEl.textContent = t("account.sign_out");
    }
    if (this.dailyHeroKickerEl) {
      this.dailyHeroKickerEl.textContent = "OIO Partice";
    }
    if (this.dailyHeroTitleEl) {
      this.dailyHeroTitleEl.textContent = t("tab.daily_capture.hero_title");
    }
    if (this.dailyHeroCopyEl) {
      this.dailyHeroCopyEl.textContent = t("tab.daily_capture.hero_description");
    }
    if (this.dailyCalendarTitleEl) {
      this.dailyCalendarTitleEl.textContent = t("tab.daily_capture.hero_calendar_title");
    }
    if (this.dailyCalendarNoteEl) {
      this.dailyCalendarNoteEl.textContent = t("tab.daily_capture.hero_calendar_note");
    }
    if (this.dailyLegendHelpBtnEl) {
      this.dailyLegendHelpBtnEl.setAttribute("aria-label", t("daily_capture.legend_help_aria"));
    }
    if (this.dailyLegendLevel1El) {
      this.dailyLegendLevel1El.textContent = t("daily_capture.legend_level_1");
    }
    if (this.dailyLegendLevel2El) {
      this.dailyLegendLevel2El.textContent = t("daily_capture.legend_level_2");
    }
    if (this.dailyLegendLevel3El) {
      this.dailyLegendLevel3El.textContent = t("daily_capture.legend_level_3");
    }
    if (this.superDictHeroKickerEl) {
      this.superDictHeroKickerEl.textContent = "Super Dict";
    }
    if (this.superDictHeroTitleEl) {
      this.superDictHeroTitleEl.textContent = t("tab.super_dict.title");
    }
    if (this.superDictHeroCopyEl) {
      this.superDictHeroCopyEl.textContent = t("tab.super_dict.hero_description");
    }
  }

  private initLocaleSwitch(): void {
    const i18n = getI18n();
    i18n.subscribe((locale) => {
      this.applyStaticI18n();
      this.renderTtsVoiceOptions();
      this.syncTtsVoiceOptions();
      this.syncLocaleButtons(locale);
      this.refreshAuthCopyFromState(getAuthService().getSnapshot());
    });

    for (const button of this.localeButtons) {
      button.addEventListener("click", () => {
        const locale = button.dataset.localeOption as Locale | undefined;
        if (!locale) return;
        i18n.setLocale(locale);
      });
    }
  }

  private syncLocaleButtons(locale: Locale): void {
    for (const button of this.localeButtons) {
      const active = button.dataset.localeOption === locale;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  private setMobileNavOpen(open: boolean): void {
    this.root?.classList.toggle("is-mobile-nav-open", open);
    this.mobileMenuBtn?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  private syncDisabledTabs(): void {
    for (const btn of this.navButtons) {
      const tabId = btn.dataset.tabTarget as AppTabId | undefined;
      const disabled = !!tabId && isTabDisabled(tabId);
      btn.disabled = disabled;
      btn.setAttribute("aria-disabled", disabled ? "true" : "false");
      btn.classList.toggle("is-disabled", disabled);
    }
  }

  private setActiveTab(tabId: AppTabId): void {
    if (isTabDisabled(tabId)) {
      return;
    }
    if (tabId !== this.activeTabId) {
      const beforeEvent = new CustomEvent("app-before-tab-change", {
        cancelable: true,
        detail: { fromTabId: this.activeTabId, toTabId: tabId },
      });
      const shouldContinue = document.dispatchEvent(beforeEvent);
      if (!shouldContinue) {
        return;
      }
    }

    this.activeTabId = tabId;
    this.root?.setAttribute("data-active-tab", tabId);
    const activeBtn = this.navButtons.find((btn) => btn.dataset.tabTarget === tabId);
    const activeLabel = activeBtn?.querySelector<HTMLElement>(".app-nav-btn-label")?.textContent?.trim()
      || getAppTabs().find((item) => item.id === tabId)?.label;
    if (activeLabel && this.mobileTitleEl) {
      this.mobileTitleEl.textContent = activeLabel;
    }

    for (const btn of this.navButtons) {
      const active = btn.dataset.tabTarget === tabId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-current", active ? "page" : "false");
    }

    for (const panel of this.panels) {
      panel.hidden = panel.dataset.tabPanel !== tabId;
    }

    if (this.oioChatRailEl) {
      this.oioChatRailEl.hidden = tabId !== "oio-chat";
    }

    document.dispatchEvent(
      new CustomEvent("app-tab-change", {
        detail: { tabId },
      }),
    );
  }

  private async initAuthPanel(): Promise<void> {
    const authService = getAuthService();
    await authService.init();
    authService.subscribe((snapshot) => {
      void this.renderAuth(snapshot);
    });
  }

  private async renderAuth(snapshot: AuthSnapshot): Promise<void> {
    this.handleAuthStatusTransition(snapshot);

    if (!this.authLabelEl || !this.authNoteEl || !this.authActionEl) {
      return;
    }

    if (snapshot.status === "disabled") {
      this.isAdminViewer = false;
      this.authPlanKey = null;
      this.authPlanUserId = null;
      this.renderAvatar("O", null);
      this.authLabelEl.textContent = t("account.auth_unavailable");
      this.authNoteEl.textContent = t("account.configure_keys");
      this.authActionEl.textContent = t("common.unavailable");
      this.authActionEl.disabled = true;
      if (this.authChipEl) {
        this.authChipEl.disabled = true;
        this.authChipEl.hidden = true;
      }
      this.setAuthMenuOpen(false);
      return;
    }

    this.authActionEl.disabled = snapshot.status === "loading";

    if (snapshot.status === "loading") {
      this.isAdminViewer = false;
      this.authPlanKey = null;
      this.authPlanUserId = null;
      this.renderAvatar("…", null);
      this.authLabelEl.textContent = t("account.loading");
      this.authNoteEl.textContent = t("account.checking_session");
      this.authActionEl.textContent = t("common.loading");
      this.authActionEl.hidden = false;
      if (this.authChipEl) {
        this.authChipEl.disabled = true;
        this.authChipEl.hidden = true;
      }
      this.setAuthMenuOpen(false);
      return;
    }

    if (snapshot.status === "signed_out") {
      this.isAdminViewer = false;
      this.authPlanKey = null;
      this.authPlanUserId = null;
      this.renderAvatar("G", null);
      this.authLabelEl.textContent = t("account.guest_mode");
      this.authNoteEl.textContent = t("account.local_only");
      this.authActionEl.textContent = t("account.sign_in");
      this.authActionEl.hidden = false;
      if (this.authChipEl) {
        this.authChipEl.disabled = true;
        this.authChipEl.hidden = true;
      }
      this.setAuthMenuOpen(false);
      return;
    }

    this.renderAvatar(snapshot.displayName.slice(0, 1).toUpperCase() || "U", snapshot.avatarUrl);
    this.authLabelEl.textContent = snapshot.displayName;
    this.authNoteEl.textContent = this.authPlanKey ? this.getPlanLabel(this.authPlanKey) : t("common.loading");
    this.authActionEl.hidden = true;
    if (this.authChipEl) {
      this.authChipEl.disabled = false;
      this.authChipEl.hidden = false;
    }
    const userId = snapshot.userId ?? null;
    if (userId && this.authPlanUserId === userId && this.authPlanKey) {
      this.authNoteEl.textContent = this.getPlanLabel(this.authPlanKey);
      return;
    }

    const requestId = ++this.accessRequestId;
    try {
      const access = await getAccessRepository().getViewerAccess();
      if (requestId !== this.accessRequestId) return;

      const hasPro = access.entitlements.some((item) => item.active);
      this.isAdminViewer = !!access.profile?.isAdmin || !!access.permissions?.canManageSubscriptions;
      this.authPlanKey = hasPro ? "pro" : "free";
      this.authPlanUserId = userId;
      this.authNoteEl.textContent = this.getPlanLabel(this.authPlanKey);
    } catch {
      this.isAdminViewer = false;
      if (requestId !== this.accessRequestId) return;
      if (this.authPlanKey) {
        this.authNoteEl.textContent = this.getPlanLabel(this.authPlanKey);
      } else {
        this.authNoteEl.textContent = t("common.loading");
      }
    }
  }

  private handleAuthStatusTransition(snapshot: AuthSnapshot): void {
    const previous = this.lastAuthStatus;
    this.lastAuthStatus = snapshot.status;
    if (snapshot.status === "signed_in" && previous !== "signed_in") {
      document.dispatchEvent(new CustomEvent("app-auth-signed-in"));
    }
  }

  private refreshAuthCopyFromState(snapshot: AuthSnapshot): void {
    if (!this.authLabelEl || !this.authNoteEl || !this.authActionEl) return;

    if (snapshot.status === "disabled") {
      this.authLabelEl.textContent = t("account.auth_unavailable");
      this.authNoteEl.textContent = t("account.configure_keys");
      this.authActionEl.textContent = t("common.unavailable");
      return;
    }

    if (snapshot.status === "loading") {
      this.authLabelEl.textContent = t("account.loading");
      this.authNoteEl.textContent = t("account.checking_session");
      this.authActionEl.textContent = t("common.loading");
      return;
    }

    if (snapshot.status === "signed_out") {
      this.authLabelEl.textContent = t("account.guest_mode");
      this.authNoteEl.textContent = t("account.local_only");
      this.authActionEl.textContent = t("account.sign_in");
      return;
    }

    this.authLabelEl.textContent = snapshot.displayName;
    this.authNoteEl.textContent = this.authPlanKey ? this.getPlanLabel(this.authPlanKey) : t("common.loading");
  }

  private getPlanLabel(plan: "free" | "pro"): string {
    return plan === "pro" ? t("subscription.pro_name") : t("subscription.free_name");
  }

  private setAuthMenuOpen(open: boolean): void {
    this.authMenuOpen = open;
    if (this.authMenuEl) {
      this.authMenuEl.hidden = !open;
    }
    if (this.authChipEl) {
      this.authChipEl.setAttribute("aria-expanded", open ? "true" : "false");
      this.authChipEl.classList.toggle("is-open", open);
    }
  }

  private renderAvatar(fallback: string, avatarUrl: string | null): void {
    if (!this.authAvatarEl) return;
    if (avatarUrl) {
      this.authAvatarEl.innerHTML = `<img src="${avatarUrl}" alt="" class="app-account-avatar-image" />`;
      return;
    }

    this.authAvatarEl.textContent = fallback;
  }

  private syncTtsVoiceOptions(): void {
    const selected = getSelectedKokoroVoiceId();
    const optionEls = this.ttsVoiceListEl?.querySelectorAll<HTMLButtonElement>("[data-tts-voice-option]") ?? [];
    for (const optionEl of optionEls) {
      const active = optionEl.dataset.ttsVoiceOption === selected;
      optionEl.setAttribute("aria-selected", active ? "true" : "false");
      optionEl.classList.toggle("is-active", active);
    }
  }

  private renderTtsVoiceOptions(): void {
    if (!this.ttsVoiceListEl) return;
    const voices = listKokoroVoiceIds();
    const groupedHtml = TTS_VOICE_GROUP_ORDER
      .map((groupId) => {
        const groupLabel = groupId === "uk" ? t("tts.voice_group.uk") : t("tts.voice_group.us");
        const buttons = voices
          .filter((voiceId) => TTS_VOICE_META[voiceId]?.group === groupId)
          .map((voiceId) => {
            const meta = TTS_VOICE_META[voiceId];
            if (!meta) return "";
            const genderLabel = t(meta.genderKey);
            return `<button type="button" class="app-tts-voice-option" data-tts-voice-option="${voiceId}" role="option" aria-selected="false">${meta.label} · ${genderLabel}</button>`;
          })
          .join("");
        if (!buttons) return "";
        return `<section class="app-tts-voice-group"><h4 class="app-tts-voice-group-title">${groupLabel}</h4><div class="app-tts-voice-group-list">${buttons}</div></section>`;
      })
      .join("");

    const fallbackHtml = voices
      .map((voiceId) => {
        return `<button type="button" class="app-tts-voice-option" data-tts-voice-option="${voiceId}" role="option" aria-selected="false">${voiceId}</button>`;
      })
      .join("");
    const html = groupedHtml || fallbackHtml;
    this.ttsVoiceListEl.innerHTML = html;
  }

  private syncTtsSourceOptions(): void {
    const selected = getAudioFacade().getActiveProviderId();
    for (const optionEl of this.ttsSourceOptionEls) {
      const active = optionEl.dataset.ttsSourceOption === selected;
      optionEl.setAttribute("aria-pressed", active ? "true" : "false");
      optionEl.classList.toggle("is-active", active);
    }
  }

  private syncTtsKokoroOptionsVisibility(): void {
    if (!this.ttsKokoroOptionsEl) return;
    this.ttsKokoroOptionsEl.hidden = getAudioFacade().getActiveProviderId() !== "kokoro";
  }

  private openTtsSettingsDialog(): void {
    if (!this.ttsSettingsDialogEl) return;
    this.syncTtsSourceOptions();
    this.syncLocaleButtons(getI18n().getLocale());
    this.syncTtsVoiceOptions();
    this.syncTtsKokoroOptionsVisibility();
    if (typeof this.ttsSettingsDialogEl.showModal === "function") {
      if (!this.ttsSettingsDialogEl.open) this.ttsSettingsDialogEl.showModal();
    } else {
      this.ttsSettingsDialogEl.hidden = false;
    }
    this.ttsSettingsOpen = true;
    if (this.ttsSettingsToggleEl) {
      this.ttsSettingsToggleEl.classList.add("is-open");
      this.ttsSettingsToggleEl.setAttribute("aria-expanded", "true");
    }
  }

  private async withTtsSwitchBlock(message: string, work: () => Promise<void>): Promise<void> {
    const shouldRestoreSettingsDialog = !!this.ttsSettingsDialogEl?.open;
    if (shouldRestoreSettingsDialog) {
      this.ttsSettingsOpen = false;
      this.ttsSettingsDialogEl?.close();
      if (this.ttsSettingsToggleEl) {
        this.ttsSettingsToggleEl.classList.remove("is-open");
        this.ttsSettingsToggleEl.setAttribute("aria-expanded", "false");
      }
    }
    this.showUiBlock(message);
    try {
      await work();
    } finally {
      this.hideUiBlock();
      if (shouldRestoreSettingsDialog) {
        this.openTtsSettingsDialog();
      }
    }
  }

  private showUiBlock(message: string): void {
    this.uiBlockCount += 1;
    this.armUiBlockSafetyTimer();
    if (this.ttsSwitchStatusEl) {
      this.ttsSwitchStatusEl.textContent = message;
    }
    if (this.ttsSwitchBlockEl) {
      this.ttsSwitchBlockEl.hidden = false;
    }
  }

  private hideUiBlock(): void {
    this.uiBlockCount = Math.max(0, this.uiBlockCount - 1);
    if (this.uiBlockCount > 0) {
      this.armUiBlockSafetyTimer();
      return;
    }
    this.clearUiBlockSafetyTimer();
    if (this.ttsSwitchBlockEl) {
      this.ttsSwitchBlockEl.hidden = true;
    }
  }

  private armUiBlockSafetyTimer(): void {
    this.clearUiBlockSafetyTimer();
    this.uiBlockSafetyTimer = window.setTimeout(() => {
      this.uiBlockCount = 0;
      this.uiBlockSafetyTimer = null;
      if (this.ttsSwitchBlockEl) {
        this.ttsSwitchBlockEl.hidden = true;
      }
    }, UI_BLOCK_SAFETY_TIMEOUT_MS);
  }

  private clearUiBlockSafetyTimer(): void {
    if (this.uiBlockSafetyTimer !== null) {
      window.clearTimeout(this.uiBlockSafetyTimer);
      this.uiBlockSafetyTimer = null;
    }
  }

  private closeTtsSettingsDialog(): void {
    this.ttsSettingsOpen = false;
    if (this.ttsSettingsDialogEl?.open) {
      this.ttsSettingsDialogEl.close();
    } else if (this.ttsSettingsDialogEl) {
      this.ttsSettingsDialogEl.hidden = true;
    }
    if (this.ttsSettingsToggleEl) {
      this.ttsSettingsToggleEl.classList.remove("is-open");
      this.ttsSettingsToggleEl.setAttribute("aria-expanded", "false");
      this.ttsSettingsToggleEl.focus();
    }
  }

  private openTtsDebugDialog(): void {
    if (!this.ttsDebugDialogEl) return;
    if (this.ttsDebugDialogEl.open) return;
    if (typeof this.ttsDebugDialogEl.showModal === "function") {
      this.ttsDebugDialogEl.showModal();
    } else {
      this.ttsDebugDialogEl.hidden = false;
    }
  }

  private appendTtsDebugLog(detail: TtsDebugEventDetail): void {
    if (!this.ttsDebugLogEl) return;
    const ts = new Date(detail.at).toLocaleTimeString();
    const stage = detail.stage || "unknown";
    const message = detail.message || "Unknown error";
    const meta = detail.meta ? ` ${JSON.stringify(detail.meta)}` : "";
    const line = `[${ts}] [${stage}] ${message}${meta}`;
    const current = this.ttsDebugLogEl.textContent?.trim() ?? "";
    const lines = current ? current.split("\n") : [];
    lines.push(line);
    if (lines.length > 120) {
      lines.splice(0, lines.length - 120);
    }
    this.ttsDebugLogEl.textContent = lines.join("\n");
  }
}
