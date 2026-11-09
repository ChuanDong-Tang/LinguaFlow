export type MemoryHomeTab = "memory" | "today" | "blind" | "podcast";

export function homeLibraryView(tab: MemoryHomeTab, rememberedView: string): string {
  return tab === "memory" || rememberedView === "trash" ? rememberedView : "all";
}

export function swipedMemoryTab(tab: MemoryHomeTab, dx: number, dy: number): MemoryHomeTab {
  if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.8) return tab;
  const tabs: MemoryHomeTab[] = ["memory", "today", "blind", "podcast"];
  return tabs[Math.max(0, Math.min(tabs.length - 1, tabs.indexOf(tab) + (dx < 0 ? 1 : -1)))];
}

export function shiftMemoryDay(day: string, direction: -1 | 1, today: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return today;
  date.setDate(date.getDate() + direction);
  const next = homeDateKey("today", false, date)!;
  return next > today ? today : next;
}

export function homeDateKey(tab: MemoryHomeTab, trash: boolean, now: Date): string | undefined {
  if (tab !== "today" || trash) return undefined;
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const copy = {
  "zh-CN": { memory: "回忆", podcast: "播客", today: "今日", blind: "盲盒", grid: "照片网格", list: "列表", subtitle: "和已经留下的生活，再见一面", open: "打开回忆盲盒", todayEmpty: "今天，还没有留下记录", todayHint: "记录此刻，把它变成你的专属回忆。" },
  "zh-TW": { memory: "回憶", podcast: "播客", today: "今日", blind: "盲盒", grid: "照片網格", list: "列表", subtitle: "和已經留下的生活，再見一面", open: "打開回憶盲盒", todayEmpty: "今天，還沒有留下記錄", todayHint: "記錄此刻，把它變成你的專屬回憶。" },
  "en-US": { memory: "Memories", podcast: "Listen", today: "Today", blind: "Rediscover", grid: "Photo grid", list: "List", subtitle: "Meet your past moments again", open: "Rediscover a memory", todayEmpty: "A new day, a new memory", todayHint: "Capture this moment and make it your own English memory." },
  "ja-JP": { memory: "思い出", podcast: "聴く", today: "今日", blind: "再発見", grid: "写真一覧", list: "リスト", subtitle: "残してきた日々に、もう一度会おう", open: "思い出を開く", todayEmpty: "今日の記録はまだありません", todayHint: "この瞬間を記録して、あなただけの英語の思い出に。" },
};
export function memoryHomeCopy(locale: string) {
  const empty = {
    "zh-CN": { dayEmpty: "这一天，还没有留下回忆", dayHint: "可以翻翻这一天的照片。", create: "留下回忆" },
    "zh-TW": { dayEmpty: "這一天，還沒有留下回憶", dayHint: "可以翻翻這一天的照片。", create: "留下回憶" },
    "en-US": { dayEmpty: "No memories from this day yet", dayHint: "Take a look at this day's photos.", create: "Keep a memory" },
    "ja-JP": { dayEmpty: "この日の思い出はまだありません", dayHint: "この日の写真を見てみましょう。", create: "思い出を残す" },
  };
  const entries = {
    "zh-CN": { todayPhotos: "今日图", randomPhotos: "盲盒", grid: "图文卡片", camera: "拍照", photos: "图片", recentPhotos: "近期", recentPhotosHint: "最近三天的照片", randomPhotosHint: "从整个相册随机翻" },
    "zh-TW": { todayPhotos: "今日圖", randomPhotos: "盲盒", grid: "圖文卡片", camera: "拍照", photos: "圖片", recentPhotos: "近期", recentPhotosHint: "最近三天的照片", randomPhotosHint: "從整個相簿隨機翻" },
    "en-US": { todayPhotos: "Today's photos", randomPhotos: "Surprise", grid: "Photo stories", camera: "Camera", photos: "Photos", recentPhotos: "Recent", recentPhotosHint: "Last three days", randomPhotosHint: "Random from your library" },
    "ja-JP": { todayPhotos: "今日の写真", randomPhotos: "ランダム", grid: "写真カード", camera: "撮影", photos: "写真", recentPhotos: "最近", recentPhotosHint: "最近 3 日間の写真", randomPhotosHint: "ライブラリからランダムに" },
  };
  return { ...(copy[locale as keyof typeof copy] ?? copy["en-US"]), ...(empty[locale as keyof typeof empty] ?? empty["en-US"]), ...(entries[locale as keyof typeof entries] ?? entries["en-US"]) };
}
