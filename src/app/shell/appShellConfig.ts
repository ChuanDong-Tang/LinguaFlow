export type AppTabId =
  | "daily-capture"
  | "rewrite"
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

export const APP_TABS: AppTabConfig[] = [
  {
    id: "daily-capture",
    label: "Daily Capture",
    navHint: "Review today’s refinements and practice them later",
    title: "Daily Capture",
    description:
      "Collect the most useful fixes from OIO Chat, keep one card per day, and return when you want to practice.",
    calendarTitle: "Capture Calendar",
    historyTitle: "Daily Capture",
    workspaceTitle: "Capture Detail",
  },
  {
    id: "rewrite",
    label: "OIO",
    navHint: "归档中的旧工作台，功能继续保留",
    title: "OIO 工作台",
    description:
      "旧 OIO 工作台已归档到单独目录管理，但页面功能仍继续保留在当前应用中。",
    calendarTitle: "OIO 日历",
    historyTitle: "改写记录",
    workspaceTitle: "OIO 工作区",
  },
  {
    id: "oio-chat",
    label: "OIO Chat",
    navHint: "Talk, refine, and save better lines into Daily Capture",
    title: "OIO Chat",
    description:
      "Use a lighter conversation flow, collect cleaner lines as you go, and leave the old OIO workspace untouched.",
    calendarTitle: "Chat Activity",
    historyTitle: "Chat Turns",
    workspaceTitle: "Conversation",
  },
  {
    id: "super-dict",
    label: "Super Dict",
    navHint: "Open dictionaries and image search tools quickly",
    title: "Super Dict",
    description:
      "Keep this page as a light resource hub instead of a heavy in-page dictionary.",
    calendarTitle: "Lookup Calendar",
    historyTitle: "Lookup History",
    workspaceTitle: "Lookup Links",
  },
];

export const DISABLED_TAB_IDS: AppTabId[] = [];

export function isTabDisabled(tabId: AppTabId): boolean {
  return DISABLED_TAB_IDS.includes(tabId);
}

export const DEFAULT_TAB_ID: AppTabId = "oio-chat";
