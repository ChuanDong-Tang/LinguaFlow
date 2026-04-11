import { getAccessRepository } from "../../infrastructure/repositories";
import { RemoteApiError, requestAppApi } from "../../infrastructure/remote/remoteApiClient";
import { type ViewerAccess } from "../../domain/access";
import { t } from "../../i18n/i18n";
import { getI18n } from "../../i18n/i18n";

function formatDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const locale = getI18n().getLocale() === "zh-CN" ? "zh-CN" : "en-US";
  return date.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDaysLeft(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = date.getTime() - Date.now();
  return diff > 0 ? Math.ceil(diff / (24 * 60 * 60 * 1000)) : 0;
}

function getPlanLabel(hasPro: boolean): string {
  return hasPro ? t("subscription.pro_name") : t("subscription.free_name");
}

export class SubscriptionController {
  private readonly root: HTMLElement | null;
  private readonly dialogEl: HTMLDialogElement | null;
  private readonly closeEl: HTMLButtonElement | null;
  private readonly heroKickerEl: HTMLElement | null;
  private readonly heroTitleEl: HTMLElement | null;
  private readonly contactEl: HTMLButtonElement | null;
  private readonly freeTitleEl: HTMLElement | null;
  private readonly freeCopyEl: HTMLElement | null;
  private readonly proTitleEl: HTMLElement | null;
  private readonly proCopyEl: HTMLElement | null;
  private readonly freeBadgeEl: HTMLElement | null;
  private readonly proBadgeEl: HTMLElement | null;
  private readonly freeCardEl: HTMLElement | null;
  private readonly proCardEl: HTMLElement | null;
  private readonly currentPlanEl: HTMLElement | null;
  private readonly manualNoteEl: HTMLElement | null;
  private readonly adminTriggerEl: HTMLButtonElement | null;
  private readonly adminPanelEl: HTMLElement | null;
  private readonly adminTitleEl: HTMLElement | null;
  private readonly adminNoteEl: HTMLElement | null;
  private readonly adminUserLabelEl: HTMLElement | null;
  private readonly adminMonthsLabelEl: HTMLElement | null;
  private readonly adminUserIdEl: HTMLInputElement | null;
  private readonly adminMonthsEl: HTMLInputElement | null;
  private readonly adminSubmitEl: HTMLButtonElement | null;
  private readonly adminStatusEl: HTMLElement | null;
  private readonly sheetEl: HTMLElement | null;
  private readonly sheetCloseEl: HTMLButtonElement | null;
  private readonly sheetKickerEl: HTMLElement | null;
  private readonly sheetTitleEl: HTMLElement | null;
  private readonly priceLabelEl: HTMLElement | null;
  private readonly priceCopyEl: HTMLElement | null;
  private readonly cnLabelEl: HTMLElement | null;
  private readonly cnCopyEl: HTMLElement | null;
  private readonly globalLabelEl: HTMLElement | null;
  private readonly globalCopyEl: HTMLElement | null;
  private readonly contactLabelEl: HTMLElement | null;
  private readonly sheetNoteEl: HTMLElement | null;
  private hasPro = false;
  private latestAccess: ViewerAccess | null = null;

  constructor({
    root = document.querySelector<HTMLElement>("[data-subscription-dialog]"),
  }: { root?: HTMLElement | null } = {}) {
    this.root = root;
    this.dialogEl = root instanceof HTMLDialogElement ? root : null;
    this.closeEl = root?.querySelector<HTMLButtonElement>("[data-subscription-close]") ?? null;
    this.heroKickerEl = root?.querySelector<HTMLElement>("[data-subscription-hero-kicker]") ?? null;
    this.heroTitleEl = root?.querySelector<HTMLElement>("[data-subscription-hero-title]") ?? null;
    this.contactEl = root?.querySelector<HTMLButtonElement>("[data-subscription-contact]") ?? null;
    this.freeTitleEl = root?.querySelector<HTMLElement>("[data-subscription-free-title]") ?? null;
    this.freeCopyEl = root?.querySelector<HTMLElement>("[data-subscription-free-copy]") ?? null;
    this.proTitleEl = root?.querySelector<HTMLElement>("[data-subscription-pro-title]") ?? null;
    this.proCopyEl = root?.querySelector<HTMLElement>("[data-subscription-pro-copy]") ?? null;
    this.freeBadgeEl = root?.querySelector<HTMLElement>("[data-subscription-free-badge]") ?? null;
    this.proBadgeEl = root?.querySelector<HTMLElement>("[data-subscription-pro-badge]") ?? null;
    this.freeCardEl = root?.querySelector<HTMLElement>("[data-subscription-free-card]") ?? null;
    this.proCardEl = root?.querySelector<HTMLElement>("[data-subscription-pro-card]") ?? null;
    this.currentPlanEl = root?.querySelector<HTMLElement>("[data-subscription-current-plan]") ?? null;
    this.manualNoteEl = root?.querySelector<HTMLElement>("[data-subscription-manual-note]") ?? null;
    this.adminTriggerEl = root?.querySelector<HTMLButtonElement>("[data-subscription-admin-trigger]") ?? null;
    this.adminPanelEl = root?.querySelector<HTMLElement>("[data-subscription-admin-panel]") ?? null;
    this.adminTitleEl = root?.querySelector<HTMLElement>("[data-subscription-admin-title]") ?? null;
    this.adminNoteEl = root?.querySelector<HTMLElement>("[data-subscription-admin-note]") ?? null;
    this.adminUserLabelEl = root?.querySelector<HTMLElement>("[data-subscription-admin-user-label]") ?? null;
    this.adminMonthsLabelEl = root?.querySelector<HTMLElement>("[data-subscription-admin-months-label]") ?? null;
    this.adminUserIdEl = root?.querySelector<HTMLInputElement>("[data-subscription-admin-user-id]") ?? null;
    this.adminMonthsEl = root?.querySelector<HTMLInputElement>("[data-subscription-admin-months]") ?? null;
    this.adminSubmitEl = root?.querySelector<HTMLButtonElement>("[data-subscription-admin-submit]") ?? null;
    this.adminStatusEl = root?.querySelector<HTMLElement>("[data-subscription-admin-status]") ?? null;
    this.sheetEl = root?.querySelector<HTMLElement>("[data-subscription-sheet]") ?? null;
    this.sheetCloseEl = root?.querySelector<HTMLButtonElement>("[data-subscription-sheet-close]") ?? null;
    this.sheetKickerEl = root?.querySelector<HTMLElement>("[data-subscription-sheet-kicker]") ?? null;
    this.sheetTitleEl = root?.querySelector<HTMLElement>("[data-subscription-sheet-title]") ?? null;
    this.priceLabelEl = root?.querySelector<HTMLElement>("[data-subscription-price-label]") ?? null;
    this.priceCopyEl = root?.querySelector<HTMLElement>("[data-subscription-price-copy]") ?? null;
    this.cnLabelEl = root?.querySelector<HTMLElement>("[data-subscription-cn-label]") ?? null;
    this.cnCopyEl = root?.querySelector<HTMLElement>("[data-subscription-cn-copy]") ?? null;
    this.globalLabelEl = root?.querySelector<HTMLElement>("[data-subscription-global-label]") ?? null;
    this.globalCopyEl = root?.querySelector<HTMLElement>("[data-subscription-global-copy]") ?? null;
    this.contactLabelEl = root?.querySelector<HTMLElement>("[data-subscription-contact-label]") ?? null;
    this.sheetNoteEl = root?.querySelector<HTMLElement>("[data-subscription-sheet-note]") ?? null;
  }

  async init(): Promise<void> {
    if (!this.root) return;

    this.applyStaticI18n();
    await this.render(true);
    getI18n().subscribe(() => {
      this.applyStaticI18n();
      this.renderFromState();
    });
    document.addEventListener("app-open-subscription", () => {
      void this.render(true);
      this.setSheetOpen(false);
      this.dialogEl?.showModal();
    });
    this.closeEl?.addEventListener("click", () => {
      this.setSheetOpen(false);
      this.dialogEl?.close();
    });
    this.contactEl?.addEventListener("click", () => {
      this.setSheetOpen(true);
    });
    this.sheetCloseEl?.addEventListener("click", () => {
      this.setSheetOpen(false);
    });
    this.adminTriggerEl?.addEventListener("click", () => {
      if (this.adminPanelEl) {
        this.adminPanelEl.hidden = !this.adminPanelEl.hidden;
      }
    });
    this.adminSubmitEl?.addEventListener("click", () => {
      void this.submitAdminActivation();
    });
  }

  private applyStaticI18n(): void {
    if (this.heroKickerEl) this.heroKickerEl.textContent = t("subscription.kicker");
    if (this.heroTitleEl) this.heroTitleEl.textContent = t("subscription.hero_title");
    if (this.freeTitleEl) this.freeTitleEl.textContent = t("subscription.free_name");
    if (this.freeCopyEl) this.freeCopyEl.textContent = t("subscription.free_copy");
    if (this.proTitleEl) this.proTitleEl.textContent = t("subscription.pro_name");
    if (this.proCopyEl) this.proCopyEl.textContent = t("subscription.pro_copy");
    if (this.contactEl) this.contactEl.textContent = this.hasPro ? t("subscription.renew_cta") : t("subscription.upgrade_cta");
    if (this.manualNoteEl) this.manualNoteEl.textContent = t("subscription.manual_note");
    if (this.adminTriggerEl) this.adminTriggerEl.textContent = t("subscription.admin_trigger");
    if (this.adminTitleEl) this.adminTitleEl.textContent = t("subscription.admin_title");
    if (this.adminNoteEl) this.adminNoteEl.textContent = t("subscription.admin_note");
    if (this.adminUserLabelEl) this.adminUserLabelEl.textContent = t("subscription.admin_user_label");
    if (this.adminMonthsLabelEl) this.adminMonthsLabelEl.textContent = t("subscription.admin_months_label");
    if (this.adminSubmitEl) this.adminSubmitEl.textContent = t("subscription.admin_submit");
    if (this.sheetKickerEl) this.sheetKickerEl.textContent = t("subscription.sheet_kicker");
    if (this.sheetTitleEl) this.sheetTitleEl.textContent = t("subscription.sheet_title");
    if (this.priceLabelEl) this.priceLabelEl.textContent = t("subscription.price_label");
    if (this.priceCopyEl) this.priceCopyEl.textContent = t("subscription.price_copy");
    if (this.cnLabelEl) this.cnLabelEl.textContent = t("subscription.cn_label");
    if (this.cnCopyEl) this.cnCopyEl.textContent = t("subscription.cn_copy");
    if (this.globalLabelEl) this.globalLabelEl.textContent = t("subscription.global_label");
    if (this.globalCopyEl) this.globalCopyEl.textContent = t("subscription.global_copy");
    if (this.contactLabelEl) this.contactLabelEl.textContent = t("subscription.contact_label");
    if (this.sheetNoteEl) this.sheetNoteEl.textContent = t("subscription.sheet_note");
  }

  private async render(forceRefresh = false): Promise<void> {
    if (!forceRefresh && this.latestAccess) {
      this.renderFromState();
      return;
    }
    try {
      const access = await getAccessRepository().getViewerAccess();
      this.latestAccess = access;
      this.renderFromState();
    } catch {
      this.renderFromState();
    }
  }

  private renderFromState(): void {
    const access = this.latestAccess;
    if (!access) {
      this.hasPro = false;
      this.applyStaticI18n();
      if (this.currentPlanEl) this.currentPlanEl.textContent = t("common.loading");
      if (this.adminTriggerEl) this.adminTriggerEl.hidden = true;
      if (this.adminPanelEl) this.adminPanelEl.hidden = true;
      if (this.freeBadgeEl) this.freeBadgeEl.textContent = "";
      if (this.freeBadgeEl) this.freeBadgeEl.hidden = true;
      if (this.proBadgeEl) {
        this.proBadgeEl.textContent = "";
        this.proBadgeEl.hidden = true;
      }
      this.freeCardEl?.classList.remove("is-current");
      this.proCardEl?.classList.remove("is-current");
      return;
    }

    const subscription = access.subscription;
    const hasPro = access.entitlements.some((item) => item.active && item.code === "pro_access");
    this.hasPro = hasPro;
    this.applyStaticI18n();

    const planName = getPlanLabel(hasPro);
    const expiresAt = subscription?.endsAt ?? access.entitlements.find((item) => item.active && item.code === "pro_access")?.expiresAt ?? null;

    if (this.currentPlanEl) {
      const expiryText = formatDateTime(expiresAt);
      const daysLeft = getDaysLeft(expiresAt);
      this.currentPlanEl.textContent = expiryText
        ? `${t("subscription.current_badge")}: ${planName} · ${t("subscription.expires_on")}: ${expiryText}${typeof daysLeft === "number" ? ` · ${daysLeft} ${t("subscription.days_left")}` : ""}`
        : `${t("subscription.current_badge")}: ${planName}`;
    }
    if (this.adminTriggerEl) this.adminTriggerEl.hidden = !access.permissions.canManageSubscriptions;
    if (this.adminPanelEl && !access.permissions.canManageSubscriptions) this.adminPanelEl.hidden = true;
    if (this.freeBadgeEl) this.freeBadgeEl.textContent = !hasPro ? t("subscription.current_badge") : "";
    if (this.proBadgeEl) this.proBadgeEl.textContent = hasPro ? t("subscription.current_badge") : "";
    if (this.freeBadgeEl) this.freeBadgeEl.hidden = hasPro;
    if (this.proBadgeEl) this.proBadgeEl.hidden = !hasPro;
    this.freeCardEl?.classList.toggle("is-current", !hasPro);
    this.proCardEl?.classList.toggle("is-current", hasPro);
  }

  private setSheetOpen(open: boolean): void {
    if (this.sheetEl) {
      this.sheetEl.hidden = !open;
    }
  }

  private async submitAdminActivation(): Promise<void> {
    const clerkUserId = this.adminUserIdEl?.value.trim() ?? "";
    const months = Number(this.adminMonthsEl?.value ?? "1");

    if (!/^user_[a-zA-Z0-9]+$/.test(clerkUserId)) {
      if (this.adminStatusEl) this.adminStatusEl.textContent = t("subscription.admin_invalid_input");
      return;
    }

    if (this.adminSubmitEl) this.adminSubmitEl.disabled = true;
    if (this.adminStatusEl) this.adminStatusEl.textContent = "...";

    try {
      await requestAppApi("/api/admin/subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clerkUserId,
          months,
          planCode: "pro_monthly",
        }),
      });
      if (this.adminStatusEl) this.adminStatusEl.textContent = t("subscription.admin_success");
      await this.render(true);
    } catch (error) {
      if (this.adminStatusEl) {
        this.adminStatusEl.textContent = error instanceof RemoteApiError && error.message
          ? error.message
          : t("subscription.admin_error");
      }
    } finally {
      if (this.adminSubmitEl) this.adminSubmitEl.disabled = false;
    }
  }
}
