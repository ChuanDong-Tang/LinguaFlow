import { t } from "../i18n/i18n";

export type AppTabId =
  | "daily-capture"
  | "oio-chat"
  | "super-dict";

export interface AppTabConfig {
  id: AppTabId;
  label: string;
  navHint: string;
  title: string;
  description: string;
  calendarTitle?: string;
  historyTitle?: string;
  workspaceTitle?: string;
}

export function getAppTabs(): AppTabConfig[] {
  return [
    {
      id: "oio-chat",
      label: t("tab.oio_chat.label"),
      navHint: t("tab.oio_chat.nav_hint"),
      title: t("tab.oio_chat.title"),
      description: t("tab.oio_chat.description"),
      calendarTitle: t("tab.oio_chat.calendar_title"),
      historyTitle: t("tab.oio_chat.history_title"),
      workspaceTitle: t("tab.oio_chat.workspace_title"),
    },
    {
      id: "daily-capture",
      label: t("tab.daily_capture.label"),
      navHint: t("tab.daily_capture.nav_hint"),
      title: t("tab.daily_capture.title"),
      description: t("tab.daily_capture.description"),
      calendarTitle: t("tab.daily_capture.calendar_title"),
      historyTitle: t("tab.daily_capture.history_title"),
      workspaceTitle: t("tab.daily_capture.workspace_title"),
    },
    {
      id: "super-dict",
      label: t("tab.super_dict.label"),
      navHint: t("tab.super_dict.nav_hint"),
      title: t("tab.super_dict.title"),
      description: t("tab.super_dict.description"),
      calendarTitle: t("tab.super_dict.calendar_title"),
      historyTitle: t("tab.super_dict.history_title"),
      workspaceTitle: t("tab.super_dict.workspace_title"),
    },
  ];
}

export const DISABLED_TAB_IDS: AppTabId[] = [];

export function isTabDisabled(tabId: AppTabId): boolean {
  return DISABLED_TAB_IDS.includes(tabId);
}

export const DEFAULT_TAB_ID: AppTabId = "oio-chat";
