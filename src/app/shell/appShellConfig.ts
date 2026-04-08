export type AppTabId =
  | "today-summary"
  | "rewrite"
  | "player"
  | "curious-baby"
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
    id: "today-summary",
    label: "今日总结",
    navHint: "回看今日学习轨迹",
    title: "今日学习总结",
    description:
      "把当天的改写、查词与播放器练习收束成一张可回看的学习卡片。这里会是你每天结束学习时最适合回顾的地方。",
    calendarTitle: "日期总览",
    historyTitle: "当日总结记录",
    workspaceTitle: "总结卡片区",
  },
  {
    id: "rewrite",
    label: "英文改写",
    navHint: "按日期查看改写记录",
    title: "英文改写工作台",
    description:
      "改写功能会强调输入、输出与历史回看。第一版先把日期导航和记录容器准备好，后续再接模型能力。",
    calendarTitle: "改写日历",
    historyTitle: "当日改写记录",
    workspaceTitle: "改写编辑区",
  },
  {
    id: "player",
    label: "分段播放器",
    navHint: "现有播放器与练习区",
    title: "分段播放器",
    description:
      "现有生成、练习、历史与导入导出能力先整体纳入新壳子，不打散现有运行时逻辑。",
  },
  {
    id: "curious-baby",
    label: "好奇宝宝",
    navHint: "保留模块骨架",
    title: "好奇宝宝",
    description:
      "这个标签页先保留产品位置与统一历史框架，具体能力后续再定义。先把入口和日期视图占住。",
    calendarTitle: "探索日历",
    historyTitle: "当日探索记录",
    workspaceTitle: "功能预留区",
  },
  {
    id: "super-dict",
    label: "超级词典",
    navHint: "查词与历史回看",
    title: "超级词典",
    description:
      "词典页会承载查词、缓存命中和历史回看。当前先把日历、记录列表和功能区骨架搭出来。",
    calendarTitle: "查词日历",
    historyTitle: "当日查词记录",
    workspaceTitle: "词典查询区",
  },
];

export const DISABLED_TAB_IDS: AppTabId[] = ["today-summary", "curious-baby"];

export function isTabDisabled(tabId: AppTabId): boolean {
  return DISABLED_TAB_IDS.includes(tabId);
}

export const DEFAULT_TAB_ID: AppTabId =
  APP_TABS.find((tab) => !isTabDisabled(tab.id))?.id ?? APP_TABS[0].id;
