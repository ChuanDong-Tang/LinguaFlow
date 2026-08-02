import React, { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  deleteCardImageUpload,
  deleteCardRecord,
  getCardRecord,
  removeCardRecordImage,
  replaceCardRecordImage,
  type CardRecordDetail,
  type CardRelationReason,
} from "../services/api/cardApi";
import {
  prepareCardDraftImage,
  removePersistentDraftImage,
  uploadCardDraftImage,
} from "../services/card/cardImageUpload";
import { CardDetailModal } from "./CardDetailModal";

export type CardDetailRequest = {
  key: number;
  recordId: string;
  initialTab?: "review" | "cloze" | "dictation";
};

export function CardDetailNavigator({
  request,
  onClose,
  onChanged,
}: {
  request: CardDetailRequest | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CardRecordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const requestSequenceRef = useRef(0);
  const shownProgressRef = useRef(new Set<string>());

  useEffect(() => {
    if (!request) {
      requestSequenceRef.current += 1;
      setDetail(null);
      setHistory([]);
      setHistoryIndex(-1);
      return;
    }
    setHistory([request.recordId]);
    setHistoryIndex(0);
    void loadDetail(request.recordId);
  }, [request?.key]);

  async function loadDetail(recordId: string): Promise<CardRecordDetail | null> {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setLoading(true);
    try {
      const resolved = await getCardRecord(recordId);
      if (requestSequenceRef.current !== sequence) return null;
      setDetail(resolved);
      return resolved;
    } catch {
      if (requestSequenceRef.current === sequence) {
        Alert.alert("暂时无法打开", "请稍后再试");
      }
      return null;
    } finally {
      if (requestSequenceRef.current === sequence) setLoading(false);
    }
  }

  async function openRelated(recordId: string, reasons: CardRelationReason[]): Promise<void> {
    if (!await loadDetail(recordId)) return;
    const next = [...history.slice(0, historyIndex + 1), recordId].slice(-100);
    setHistory(next);
    setHistoryIndex(next.length - 1);
    const growth = reasons.find(
      (reason): reason is Extract<CardRelationReason, { type: "progress" }> =>
        reason.type === "progress" && reason.isFirstUserProduced,
    );
    if (!growth) return;
    const key = `${recordId}:${growth.phraseId}`;
    if (shownProgressRef.current.has(key)) return;
    shownProgressRef.current.add(key);
    Alert.alert("成长时刻", `“${growth.phrase}”曾在过去的 AI 改写中出现，现在你主动使用了。`);
  }

  async function navigateHistory(nextIndex: number): Promise<void> {
    const recordId = history[nextIndex];
    if (!recordId || !await loadDetail(recordId)) return;
    setHistoryIndex(nextIndex);
  }

  function close(): void {
    requestSequenceRef.current += 1;
    setDetail(null);
    setHistory([]);
    setHistoryIndex(-1);
    onChanged();
    onClose();
  }

  function confirmDelete(): void {
    if (!detail) return;
    const recordId = detail.id;
    Alert.alert("删除这条记录？", "删除后无法恢复", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => void deleteCardRecord(recordId)
          .then(() => {
            close();
          })
          .catch(() => Alert.alert("删除失败", "请稍后重试")),
      },
    ]);
  }

  function chooseImage(): void {
    if (!detail) return;
    Alert.alert("选择图片", undefined, [
      { text: "拍照", onPress: () => void pickImage(detail.id, "camera") },
      { text: "从相册选择", onPress: () => void pickImage(detail.id, "library") },
      { text: "取消", style: "cancel" },
    ]);
  }

  async function pickImage(recordId: string, source: "camera" | "library"): Promise<void> {
    const permission = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要图片权限", source === "camera" ? "请允许使用相机后再拍照" : "请允许访问相册后再选择图片");
      return;
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const selected = result.assets?.[0];
    if (result.canceled || !selected?.uri || !selected.width || !selected.height) return;
    let prepared: Awaited<ReturnType<typeof prepareCardDraftImage>> | null = null;
    let unclaimedUploadId: string | null = null;
    setLoading(true);
    try {
      prepared = await prepareCardDraftImage({
        uri: selected.uri,
        width: selected.width,
        height: selected.height,
      });
      const ready = await uploadCardDraftImage(prepared, () => undefined);
      if (!ready.uploadId) throw new Error("图片上传没有完成");
      unclaimedUploadId = ready.uploadId;
      const updated = await replaceCardRecordImage(recordId, ready.uploadId);
      unclaimedUploadId = null;
      setDetail(updated);
      onChanged();
    } catch (error) {
      if (unclaimedUploadId) void deleteCardImageUpload(unclaimedUploadId).catch(() => undefined);
      Alert.alert("无法更换图片", error instanceof Error ? error.message : "原图片已保留，请稍后重试");
    } finally {
      if (prepared) removePersistentDraftImage(prepared.localUri);
      setLoading(false);
    }
  }

  function confirmRemoveImage(): void {
    if (!detail?.image) return;
    const recordId = detail.id;
    Alert.alert("移除这张图片？", "文字记录会继续保留", [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: () => void removeCardRecordImage(recordId)
          .then((updated) => {
            setDetail(updated);
            onChanged();
          })
          .catch(() => Alert.alert("移除失败", "原图片已保留，请稍后重试")),
      },
    ]);
  }

  if (!request) return null;
  return (
    <CardDetailModal
      detail={detail}
      loading={loading}
      initialTab={request.initialTab}
      onClose={close}
      canGoBack={historyIndex > 0}
      canGoForward={historyIndex >= 0 && historyIndex < history.length - 1}
      onBack={() => void navigateHistory(historyIndex - 1)}
      onForward={() => void navigateHistory(historyIndex + 1)}
      onOpenRelated={(recordId, reasons) => void openRelated(recordId, reasons)}
      onDelete={detail ? confirmDelete : undefined}
      onReplaceImage={detail ? chooseImage : undefined}
      onRemoveImage={detail?.image ? confirmRemoveImage : undefined}
    />
  );
}
