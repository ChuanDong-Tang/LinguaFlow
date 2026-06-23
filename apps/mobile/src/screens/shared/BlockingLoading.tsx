import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { t } from "../../i18n";

export type BlockingLoadingOptions = {
  text?: string;
  blocking?: boolean;
  abortable?: boolean;
  cancelableAfterMs?: number;
  timeoutMs?: number;
  onCancel?: () => void;
  onTimeout?: () => void;
};

// 全局阻塞式 loading：用于所有“可能等待数据库/网络”的用户动作。
// 视觉层默认拦截点击，避免用户在同一个写库动作未完成时继续操作。
export function BlockingLoading({
  visible,
  options,
}: {
  visible: boolean;
  options: BlockingLoadingOptions | null;
}) {
  const [canCancel, setCanCancel] = useState(false);

  useEffect(() => {
    if (!visible || !options) return;
    setCanCancel(options.abortable === true && !options.cancelableAfterMs);
    const cancelTimer = options.abortable
      ? setTimeout(() => setCanCancel(true), Math.max(0, options.cancelableAfterMs ?? 0))
      : null;
    const timeoutTimer = options.timeoutMs
      ? setTimeout(() => options.onTimeout?.(), Math.max(0, options.timeoutMs))
      : null;
    return () => {
      if (cancelTimer) clearTimeout(cancelTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };
  }, [options, visible]);

  if (!visible || !options) return null;

  return (
    <View style={styles.backdrop} pointerEvents={options.blocking === false ? "box-none" : "auto"}>
      <View style={styles.panel}>
        {canCancel ? (
          <Pressable style={styles.closeButton} onPress={options.onCancel} hitSlop={8}>
            <Ionicons name="close" size={18} color="#5B6070" />
          </Pressable>
        ) : null}
        <ActivityIndicator size="large" color="#7C6CFF" />
        {options.text ? <Text style={styles.text}>{options.text}</Text> : null}
      </View>
    </View>
  );
}

// 延迟显示 loading：网络快时不打扰用户；超过 delayMs 才弹出阻塞层。
// 取消/超时会 abort signal，并忽略之后才返回的结果，防止 UI 回写过期状态。
export async function runWithDeferredBlockingLoading<T>(
  task: (signal: AbortSignal) => Promise<T>,
  controls: {
    show: (options: BlockingLoadingOptions) => void;
    hide: () => void;
  },
  options?: BlockingLoadingOptions & { delayMs?: number },
): Promise<T> {
  const controller = new AbortController();
  let settled = false;
  let loadingShown = false;
  let ignoreResult = false;
  const delayMs = options?.delayMs ?? 200;

  const showTimer = setTimeout(() => {
    if (settled) return;
    loadingShown = true;
    controls.show({
      text: options?.text,
      blocking: options?.blocking ?? true,
      abortable: options?.abortable ?? true,
      cancelableAfterMs: options?.cancelableAfterMs ?? 10000,
      timeoutMs: options?.timeoutMs ?? 20000,
      onCancel: () => {
        ignoreResult = true;
        controller.abort();
        controls.hide();
        options?.onCancel?.();
      },
      onTimeout: () => {
        ignoreResult = true;
        controller.abort();
        controls.hide();
        options?.onTimeout?.();
      },
    });
  }, delayMs);

  try {
    const result = await task(controller.signal);
    if (ignoreResult) {
      throw new Error(t("common.operation_cancelled"));
    }
    return result;
  } finally {
    settled = true;
    clearTimeout(showTimer);
    if (loadingShown) controls.hide();
  }
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.42)",
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    minWidth: 128,
    minHeight: 112,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4E6EE",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    shadowColor: "#111111",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  closeButton: {
    position: "absolute",
    right: 8,
    top: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4F5F8",
  },
  text: {
    marginTop: 12,
    color: "#313541",
    fontSize: 14,
    fontWeight: "600",
  },
});
