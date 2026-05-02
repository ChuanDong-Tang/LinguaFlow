import AsyncStorage from "@react-native-async-storage/async-storage";

type LogLevel = "info" | "warn" | "error";

export type AppLog = {
  time: string; // ISO 时间，方便排序和检索
  level: LogLevel; // 日志级别
  event: string; // 事件名：如 login_success
  message?: string; // 简短说明
  extra?: Record<string, unknown>; // 扩展字段（注意不要放明文 token）
};

const LOG_KEY = "lf_app_logs";
const MAX_LOGS = 200;

/** 读取全部日志：若损坏则兜底为空数组 */
export async function getLogs(): Promise<AppLog[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AppLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    await AsyncStorage.removeItem(LOG_KEY);
    return [];
  }
}

/** 追加一条日志：只保留最近 MAX_LOGS 条 */
export async function appendLog(input: Omit<AppLog, "time">): Promise<void> {
  const logs = await getLogs();
  const next: AppLog = {
    time: new Date().toISOString(),
    ...input
  };
  const merged = [...logs, next].slice(-MAX_LOGS);
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(merged));
}

/** 清空日志：可用于“清理缓存”按钮 */
export async function clearLogs(): Promise<void> {
  await AsyncStorage.removeItem(LOG_KEY);
}

/** 统一日志入口 */
export async function logEvent(
  event: string,
  level: LogLevel = "info",
  message?: string,
  extra?: Record<string, unknown>
): Promise<void> {
  await appendLog({ event, level, message, extra });
}

