import { dateToLocalKey } from "../../dateUtils.js";
import { getAccessRepository } from "../../infrastructure/repositories";

export interface PracticeQuotaSnapshot {
  planCode: "free" | "pro";
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  isPro: boolean;
}

const FREE_DAILY_LIMIT = 3;
const PRO_DAILY_LIMIT = 20;
const STORAGE_PREFIX = "oio-practice-usage";

class PracticeQuotaService {
  async getSnapshot(): Promise<PracticeQuotaSnapshot> {
    const access = await this.getViewerAccessSafe();
    const isPro = access.entitlements.some((item) => item.active && item.code === "pro_access");
    const dailyLimit = isPro ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
    const usedToday = this.readUsedCount(this.buildViewerKey(access.profile?.appUserId, access.profile?.clerkUserId));

    return {
      planCode: isPro ? "pro" : "free",
      dailyLimit,
      usedToday,
      remainingToday: Math.max(dailyLimit - usedToday, 0),
      isPro,
    };
  }

  async consumeOne(): Promise<PracticeQuotaSnapshot> {
    const access = await this.getViewerAccessSafe();
    const isPro = access.entitlements.some((item) => item.active && item.code === "pro_access");
    const dailyLimit = isPro ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
    const viewerKey = this.buildViewerKey(access.profile?.appUserId, access.profile?.clerkUserId);
    const nextUsed = Math.min(this.readUsedCount(viewerKey) + 1, dailyLimit);
    this.writeUsedCount(viewerKey, nextUsed);

    return {
      planCode: isPro ? "pro" : "free",
      dailyLimit,
      usedToday: nextUsed,
      remainingToday: Math.max(dailyLimit - nextUsed, 0),
      isPro,
    };
  }

  private async getViewerAccessSafe() {
    try {
      return await getAccessRepository().getViewerAccess();
    } catch {
      return {
        profile: null,
        entitlements: [],
        subscription: null,
        permissions: {
          canUseRewrite: true,
          canManageSubscriptions: false,
          canSyncHistory: false,
        },
      };
    }
  }

  private buildViewerKey(appUserId: string | null | undefined, clerkUserId: string | null | undefined): string {
    return appUserId || clerkUserId || "guest";
  }

  private buildStorageKey(viewerKey: string): string {
    return `${STORAGE_PREFIX}:${viewerKey}:${dateToLocalKey(new Date())}`;
  }

  private readUsedCount(viewerKey: string): number {
    try {
      const raw = window.localStorage.getItem(this.buildStorageKey(viewerKey));
      const value = Number(raw ?? "0");
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    } catch {
      return 0;
    }
  }

  private writeUsedCount(viewerKey: string, count: number): void {
    try {
      window.localStorage.setItem(this.buildStorageKey(viewerKey), String(count));
    } catch {
      // Ignore storage failures and fall back to an in-memory-like experience.
    }
  }
}

const practiceQuotaService = new PracticeQuotaService();

export function getPracticeQuotaService(): PracticeQuotaService {
  return practiceQuotaService;
}
