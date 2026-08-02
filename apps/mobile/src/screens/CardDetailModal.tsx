import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ActionSheetIOS,
  Animated,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as MediaLibrary from "expo-media-library";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  saveCardDictationResult,
  saveCardClozeUpdate,
  getCardSegmentAudio,
  getCardSelectionAudio,
  getCardRelations,
  type CardClozeState,
  type CardRelationReason,
  type CardRecordDetail,
} from "../services/api/cardApi";
import type { CardDraft } from "../services/card/cardDraftStorage";
import { theme } from "../theme";
import { playTtsAudio, stopTtsAudio } from "../services/tts/ttsPlayback";
import {
  SelectableMessageText,
  type NativeTextSelectionPayload,
} from "./chat/SelectableMessageText";
import { DictionaryPopover } from "./chat/DictionaryPopover";
import { lookupDictionary, type DictionaryLookupResult } from "../services/api/dictionaryApi";
import { getLanguage } from "../i18n";
import { expandSelectionToTokenRange, tokenizeForCloze, type ClozeToken } from "../domain/cloze/clozeUtils";
import { ClozeTokenEditor } from "./shared/ClozeTokenEditor";
import { buildClozeFlowSegments, ClozeTokenFlow } from "./shared/ClozeTokenFlow";

type DetailTab = "review" | "cloze" | "dictation";

export function CardDetailModal({ detail, loading, draft, initialTab = "review", onClose, onDelete, onReplaceImage, onRemoveImage, onDraftChange, onDraftGenerate, onDraftChooseImage, onDraftTakePhoto, onDraftSelectImage, onDraftRemoveImage, canGoBack = false, canGoForward = false, onBack, onForward, onOpenRelated }: {
  detail: CardRecordDetail | null;
  loading: boolean;
  draft?: {
    value: CardDraft;
    sending: boolean;
  };
  initialTab?: DetailTab;
  onClose: () => void;
  onDelete?: () => void;
  onReplaceImage?: () => void;
  onRemoveImage?: () => void;
  onDraftChange?: (text: string) => void;
  onDraftGenerate?: () => void;
  onDraftChooseImage?: () => void;
  onDraftTakePhoto?: () => void;
  onDraftSelectImage?: (asset: { uri: string; width: number; height: number }) => void;
  onDraftRemoveImage?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  onOpenRelated?: (recordId: string, reasons: CardRelationReason[]) => void;
}) {
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const practiceMode = initialTab !== "review";
  const [clozeState, setClozeState] = useState<CardClozeState>({ schemaVersion: 1, blanks: [] });
  const [clozeVersion, setClozeVersion] = useState(0);
  useEffect(() => {
    if (detail) {
      setTab(initialTab);
      setClozeState(asCardClozeState(detail.practice?.clozeState));
      setClozeVersion(detail.practice?.clozeVersion ?? 0);
    }
  }, [detail?.id, initialTab]);
  const updateCloze = (state: CardClozeState, version: number) => {
    setClozeState(state);
    setClozeVersion(version);
  };
  const [relations, setRelations] = useState<Array<{ recordId: string; topic: string | null; reasons: CardRelationReason[] }>>([]);
  const [relationsLoading, setRelationsLoading] = useState(false);
  useEffect(() => {
    if (!detail) {
      setRelations([]);
      return;
    }
    let cancelled = false;
    setRelationsLoading(true);
    const request = getCardRelations(detail.id, 50);
    void request.then((items) => { if (!cancelled) setRelations(items); })
      .catch(() => { if (!cancelled) setRelations([]); })
      .finally(() => { if (!cancelled) setRelationsLoading(false); });
    return () => { cancelled = true; };
  }, [detail?.id]);
  function openMore(): void {
    const options = [
      ...(onReplaceImage ? [detail?.image ? "更换图片" : "添加图片"] : []),
      ...(onRemoveImage ? ["移除图片"] : []),
      ...(onDelete ? ["删除记录"] : []),
      "取消",
    ];
    const cancelButtonIndex = options.length - 1;
    const deleteIndex = onDelete ? options.indexOf("删除记录") : -1;
    const run = (index: number) => {
      const action = options[index];
      if (action === "更换图片" || action === "添加图片") onReplaceImage?.();
      else if (action === "移除图片") onRemoveImage?.();
      else if (action === "删除记录") onDelete?.();
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex, destructiveButtonIndex: deleteIndex >= 0 ? deleteIndex : undefined },
        run,
      );
    } else {
      Alert.alert("", undefined, options.map((text, index) => ({
        text,
        style: text === "取消" ? "cancel" as const : text.includes("删除") || text.includes("移除") ? "destructive" as const : "default" as const,
        onPress: () => run(index),
      })));
    }
  }
  if (draft) {
    return (
      <DraftCard
        draft={draft.value}
        sending={draft.sending}
        onClose={onClose}
        onChangeText={onDraftChange}
        onGenerate={onDraftGenerate}
        onChooseImage={onDraftChooseImage}
        onTakePhoto={onDraftTakePhoto}
        onSelectImage={onDraftSelectImage}
        onRemoveImage={onDraftRemoveImage}
      />
    );
  }
  if (!detail && !loading) return null;
  return (
    <View style={styles.fullscreen}>
      <SafeAreaView style={styles.page}>
        <View style={styles.header}>
          <View style={styles.historyButtons}>
            <Pressable accessibilityLabel={canGoBack ? "后退" : "关闭"} style={styles.historyButton} onPress={canGoBack ? onBack : onClose}><Ionicons name="chevron-back" size={22} color={theme.colors.text} /></Pressable>
            {practiceMode && canGoForward ? <Pressable accessibilityLabel="前进" style={styles.historyButton} onPress={onForward}><Ionicons name="chevron-forward" size={22} color={theme.colors.text} /></Pressable> : null}
          </View>
          <Text numberOfLines={1} style={styles.title}>{practiceMode ? "练习" : ""}</Text>
          <View style={styles.headerEnd}>
            {practiceMode
              ? <Pressable accessibilityLabel="退出" style={styles.iconHeaderButton} onPress={onClose}><Ionicons name="close" size={23} color={theme.colors.text} /></Pressable>
              : <Pressable accessibilityLabel="更多操作" style={styles.iconHeaderButton} onPress={openMore} disabled={!detail}><Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} /></Pressable>}
          </View>
        </View>
        {loading && !detail ? <ActivityIndicator color={theme.colors.accentStrong} style={styles.loader} /> : null}
        {detail && tab === "review" ? <Review detail={detail} clozeState={clozeState} clozeVersion={clozeVersion} onClozeChange={updateCloze} onReplaceImage={onReplaceImage} onRemoveImage={onRemoveImage} relations={relations} relationsLoading={relationsLoading} onOpenRelated={onOpenRelated} /> : null}
        {detail && tab === "cloze" ? <Cloze detail={detail} clozeState={clozeState} clozeVersion={clozeVersion} onClozeChange={updateCloze} /> : null}
        {detail && tab === "dictation" ? <Dictation detail={detail} /> : null}
        {detail ? <CardPracticeToolbar value={tab} onChange={setTab} /> : null}
      </SafeAreaView>
    </View>
  );
}

function DraftCard({ draft, sending, onClose, onChangeText, onGenerate, onChooseImage, onTakePhoto, onSelectImage, onRemoveImage }: {
  draft: CardDraft;
  sending: boolean;
  onClose: () => void;
  onChangeText?: (text: string) => void;
  onGenerate?: () => void;
  onChooseImage?: () => void;
  onTakePhoto?: () => void;
  onSelectImage?: (asset: { uri: string; width: number; height: number }) => void;
  onRemoveImage?: () => void;
}) {
  const processing = draft.submitted;
  const count = countGraphemes(draft.text);
  const canGenerate = count > 0 && count <= 3_000 && (!draft.image || draft.image.status === "ready");
  const [photoRailVisible, setPhotoRailVisible] = useState(false);
  const [recentPhotos, setRecentPhotos] = useState<MediaLibrary.Asset[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  async function togglePhotoRail(): Promise<void> {
    if (photoRailVisible) {
      setPhotoRailVisible(false);
      return;
    }
    setPhotosLoading(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
      if (!permission.granted) {
        Alert.alert("需要照片权限", "允许访问照片后，才能在这里显示最近照片。");
        return;
      }
      const page = await MediaLibrary.getAssetsAsync({
        first: 20,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      setRecentPhotos(page.assets);
      setPhotoRailVisible(true);
    } catch {
      Alert.alert("暂时无法读取照片", "可以使用“全部照片”从系统相册选择。");
    } finally {
      setPhotosLoading(false);
    }
  }
  async function selectRecentPhoto(asset: MediaLibrary.Asset): Promise<void> {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(asset);
      onSelectImage?.({ uri: info.localUri || info.uri, width: info.width, height: info.height });
      setPhotoRailVisible(false);
    } catch {
      Alert.alert("无法读取这张照片", "请从系统相册重新选择。");
    }
  }
  return (
    <View style={styles.fullscreen}>
      <SafeAreaView style={styles.page}>
        <View style={styles.header}>
          <View style={styles.draftHeaderSide}>
            <Pressable style={styles.draftHeaderButton} disabled={sending} onPress={onClose}>
              <Text style={styles.draftHeaderText}>{processing ? "完成" : "取消"}</Text>
            </Pressable>
          </View>
          <View style={styles.draftHeaderCenter} />
          <View style={styles.draftHeaderSide} />
        </View>
        {processing ? (
          <ScrollView contentContainerStyle={styles.draftContent}>
            <Text style={styles.date}>{formatDraftDate()}</Text>
            {draft.image ? <Image source={{ uri: draft.image.localUri }} style={styles.draftImage} resizeMode="cover" /> : null}
            <Text style={styles.original}>{draft.text}</Text>
            <View style={styles.divider} />
            <DraftProcessingLines />
          </ScrollView>
        ) : (
          <View style={styles.draftContentPage}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.draftEditorContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.date}>{formatDraftDate()}</Text>
              {draft.image ? (
                <View style={[styles.draftImageWrap, { aspectRatio: Math.max(0.8, Math.min(1.8, draft.image.width / draft.image.height)) }]}>
                  <Image source={{ uri: draft.image.localUri }} style={styles.draftImageFill} resizeMode="cover" />
                  {draft.image.status === "uploading" || draft.image.status === "moderating" ? <View style={styles.draftImageOverlay}><ActivityIndicator color={theme.colors.surface} /></View> : null}
                  {draft.image.status === "failed" ? <View style={styles.draftImageOverlay}><Ionicons name="alert-circle-outline" size={24} color={theme.colors.surface} /></View> : null}
                  <Pressable accessibilityLabel="移除图片" style={styles.draftImageRemove} onPress={onRemoveImage}><Ionicons name="close" size={16} color={theme.colors.surface} /></Pressable>
                </View>
              ) : null}
              <TextInput
                autoFocus
                multiline
                scrollEnabled={false}
                value={draft.text}
                editable={!sending}
                maxLength={10_000}
                placeholder="写下这一刻……"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.draftInput}
                textAlignVertical="top"
                onChangeText={onChangeText}
              />
              <View style={styles.draftExpressionDivider} />
              <View style={styles.draftExpressionPlaceholder}>
                <Pressable
                  accessibilityLabel="生成更自然的表达"
                  disabled={sending || !canGenerate}
                  style={[styles.draftRewriteButton, !canGenerate && styles.draftRewriteButtonDisabled]}
                  onPress={onGenerate}
                >
                  {sending
                    ? <ActivityIndicator size="small" color={theme.colors.accentStrong} />
                    : <Text style={styles.draftRewriteButtonText}>生成表达</Text>}
                </Pressable>
              </View>
            </ScrollView>
            {photoRailVisible ? (
              <ScrollView horizontal style={styles.photoRail} contentContainerStyle={styles.photoRailContent} showsHorizontalScrollIndicator={false}>
                {recentPhotos.map((asset) => (
                  <Pressable key={asset.id} accessibilityLabel={`选择照片 ${asset.filename}`} style={styles.photoRailItem} onPress={() => void selectRecentPhoto(asset)}>
                    <Image source={{ uri: asset.uri }} style={styles.photoRailImage} />
                  </Pressable>
                ))}
                <Pressable accessibilityLabel="打开全部照片" style={styles.photoRailAll} onPress={() => {
                  setPhotoRailVisible(false);
                  onChooseImage?.();
                }}>
                  <Ionicons name="images-outline" size={22} color={theme.colors.textSecondary} />
                  <Text style={styles.photoRailAllText}>全部照片</Text>
                </Pressable>
              </ScrollView>
            ) : null}
            <CardPageToolbar>
              <Pressable accessibilityLabel={photoRailVisible ? "收起照片栏" : draft.image ? "更换图片" : "添加图片"} style={styles.draftToolButton} onPress={() => void togglePhotoRail()}>
                <Ionicons name={draft.image ? "images-outline" : "image-outline"} size={22} color={theme.colors.textSecondary} />
              </Pressable>
              <Pressable accessibilityLabel="拍照" style={styles.draftToolButton} disabled={sending} onPress={onTakePhoto}>
                <Ionicons name="camera-outline" size={23} color={theme.colors.textSecondary} />
              </Pressable>
              {photosLoading ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : null}
              {draft.image?.status === "failed" ? <Text style={styles.draftImageError}>图片处理失败</Text> : null}
              <View style={styles.draftToolbarSpacer} />
              {count > 2_700 ? <Text style={[styles.draftCounter, count > 3_000 && styles.draftCounterError]}>{count} / 3000</Text> : null}
            </CardPageToolbar>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

function CardPageToolbar({ children }: { children: React.ReactNode }) {
  return <View style={styles.cardPageToolbar}>{children}</View>;
}

function CardPracticeToolbar({ value, onChange }: {
  value: DetailTab;
  onChange: (value: DetailTab) => void;
}) {
  const items: Array<{ value: DetailTab; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = [
    { value: "review", label: "回看", icon: "book-outline" },
    { value: "cloze", label: "填空", icon: "create-outline" },
    { value: "dictation", label: "听写", icon: "headset-outline" },
  ];
  return (
    <CardPageToolbar>
      {items.map((item) => {
        const active = value === item.value;
        return (
          <Pressable
            key={item.value}
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={styles.practiceToolButton}
            onPress={() => onChange(item.value)}
          >
            <Ionicons name={item.icon} size={21} color={active ? theme.colors.accentStrong : theme.colors.textMuted} />
            <Text style={[styles.practiceToolText, active && styles.practiceToolTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </CardPageToolbar>
  );
}

function DraftProcessingLines() {
  const opacity = useRef(new Animated.Value(0.28)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.72, duration: 900, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.28, duration: 900, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return (
    <Animated.View style={[styles.draftProcessingLines, { opacity }]}>
      <View style={styles.draftProcessingLineLong} />
      <View style={styles.draftProcessingLineShort} />
    </Animated.View>
  );
}

function formatDraftDate(): string {
  return new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
}

function countGraphemes(value: string): number {
  const Segmenter = (Intl as unknown as { Segmenter?: new (...args: unknown[]) => { segment: (text: string) => Iterable<unknown> } }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(value)).length : Array.from(value).length;
}

type DictionaryLookupState = {
  term: string;
  loading: boolean;
  error: string | null;
  result: DictionaryLookupResult | null;
  anchor?: NativeTextSelectionPayload["selectionRect"];
  segmentId: string;
  start: number;
  end: number;
};

type CardClozeEditorState = {
  blank: CardClozeState["blanks"][number];
  tokens: ClozeToken[];
  selectedTokenIndexes: number[];
};

function Review({ detail, clozeState, clozeVersion, onClozeChange, onReplaceImage, onRemoveImage, relations, relationsLoading, onOpenRelated }: {
  detail: CardRecordDetail;
  clozeState: CardClozeState;
  clozeVersion: number;
  onClozeChange: (state: CardClozeState, version: number) => void;
  onReplaceImage?: () => void;
  onRemoveImage?: () => void;
  relations: Array<{ recordId: string; topic: string | null; reasons: CardRelationReason[] }>;
  relationsLoading: boolean;
  onOpenRelated?: (recordId: string, reasons: CardRelationReason[]) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [savingCloze, setSavingCloze] = useState(false);
  const [answersVisible, setAnswersVisible] = useState(false);
  const [showRelations, setShowRelations] = useState(false);
  const [dictionary, setDictionary] = useState<DictionaryLookupState | null>(null);
  const [clozeEditor, setClozeEditor] = useState<CardClozeEditorState | null>(null);
  const dictionaryRequestRef = useRef(0);
  useEffect(() => setAnswersVisible(false), [detail.id]);
  async function play(): Promise<void> {
    if (playing) { await stopTtsAudio(); setPlaying(false); return; }
    const segment = detail.rewriteSegments[0];
    if (!segment) return;
    setPlaying(true);
    try {
      const audio = await getCardSegmentAudio({
        entryId: detail.id.slice("card:".length),
        segmentId: segment.id,
        sourceKind: "review_segment",
      });
      await playTtsAudio({ url: audio.audioUrl });
    } finally { setPlaying(false); }
  }
  async function addBlank(segment: CardRecordDetail["rewriteSegments"][number], payload: NativeTextSelectionPayload): Promise<void> {
    if (savingCloze) return;
    const expanded = expandSelectionToTokenRange(segment.text, payload.start, payload.end, null);
    if (!expanded || !segment.text.slice(expanded.start, expanded.end).trim()) return;
    const { start, end } = expanded;
    const overlaps = clozeState.blanks.some((blank) => blank.segmentId === segment.id && blank.startUtf16 < end && blank.endUtf16 > start);
    if (overlaps) {
      Alert.alert("这段内容已经设置过填空");
      return;
    }
    setSavingCloze(true);
    try {
      const practice = await saveCardClozeUpdate(detail.id, {
        baseVersion: clozeVersion,
        operation: { type: "add", segmentId: segment.id, startUtf16: start, endUtf16: end },
      });
      onClozeChange(asCardClozeState(practice.clozeState), practice.clozeVersion);
    } catch (error) {
      Alert.alert("无法保存挖空", error instanceof Error ? error.message : "请刷新后重试");
    } finally {
      setSavingCloze(false);
    }
  }

  async function removeBlank(blank: CardClozeState["blanks"][number]): Promise<void> {
    if (savingCloze) return;
    setSavingCloze(true);
    try {
      const practice = await saveCardClozeUpdate(detail.id, {
        baseVersion: clozeVersion,
        operation: { type: "remove", blankId: blank.id },
      });
      onClozeChange(asCardClozeState(practice.clozeState), practice.clozeVersion);
    } catch (error) {
      Alert.alert("无法删除挖空", error instanceof Error ? error.message : "请刷新后重试");
    } finally {
      setSavingCloze(false);
    }
  }

  function lookup(segment: CardRecordDetail["rewriteSegments"][number], payload: NativeTextSelectionPayload): void {
    const term = payload.selectedText.trim();
    if (!term) return;
    Keyboard.dismiss();
    const sequence = dictionaryRequestRef.current + 1;
    dictionaryRequestRef.current = sequence;
    setDictionary({
      term,
      loading: true,
      error: null,
      result: null,
      anchor: payload.selectionRect,
      segmentId: segment.id,
      start: payload.start,
      end: payload.end,
    });
    void lookupDictionary({
      term,
      context: segment.text,
      selectionStart: payload.start,
      selectionEnd: payload.end,
      targetLanguage: detail.languageCode,
      uiLanguage: getLanguage(),
      contactId: "curious_companion",
      messageId: null,
    }).then((result) => {
      if (dictionaryRequestRef.current !== sequence) return;
      setDictionary((current) => current ? { ...current, loading: false, result, error: null } : null);
    }).catch((error) => {
      if (dictionaryRequestRef.current !== sequence) return;
      console.warn("[card] dictionary lookup failed", error);
      setDictionary((current) => current ? { ...current, loading: false, error: "暂时无法查词" } : null);
    });
  }

  function openBlankActions(blank: CardClozeState["blanks"][number]): void {
    const segment = detail.rewriteSegments.find((candidate) => candidate.id === blank.segmentId);
    if (!segment) return;
    const payload = {
      start: blank.startUtf16,
      end: blank.endUtf16,
      selectedText: segment.text.slice(blank.startUtf16, blank.endUtf16),
    };
    Alert.alert(payload.selectedText, undefined, [
      { text: "查词", onPress: () => lookup(segment, payload) },
      { text: "编辑填空", onPress: () => {
        const tokens = tokenizeForCloze(segment.text).filter((token) => token.end > blank.startUtf16 && token.start < blank.endUtf16);
        setClozeEditor({ blank, tokens, selectedTokenIndexes: tokens.map((token) => token.index) });
      } },
      { text: "删除挖空", style: "destructive", onPress: () => void removeBlank(blank) },
      { text: "取消", style: "cancel" },
    ]);
  }

  async function confirmClozeEditor(): Promise<void> {
    if (!clozeEditor || savingCloze) return;
    const segment = detail.rewriteSegments.find((candidate) => candidate.id === clozeEditor.blank.segmentId);
    if (!segment) return;
    const selected = new Set(clozeEditor.selectedTokenIndexes);
    const selectedTokens = clozeEditor.tokens.filter((token) => selected.has(token.index));
    const ranges: Array<{ startUtf16: number; endUtf16: number }> = [];
    selectedTokens.forEach((token) => {
      const previous = ranges[ranges.length - 1];
      if (previous && segment.text.slice(previous.endUtf16, token.start).trim() === "") previous.endUtf16 = token.end;
      else ranges.push({ startUtf16: token.start, endUtf16: token.end });
    });
    setClozeEditor(null);
    setSavingCloze(true);
    let version = clozeVersion;
    let latestState = clozeState;
    try {
      let practice = await saveCardClozeUpdate(detail.id, {
        baseVersion: version,
        operation: { type: "remove", blankId: clozeEditor.blank.id },
      });
      version = practice.clozeVersion;
      latestState = asCardClozeState(practice.clozeState);
      onClozeChange(latestState, version);
      for (const range of ranges) {
        practice = await saveCardClozeUpdate(detail.id, {
          baseVersion: version,
          operation: { type: "add", segmentId: segment.id, ...range },
        });
        version = practice.clozeVersion;
        latestState = asCardClozeState(practice.clozeState);
        onClozeChange(latestState, version);
      }
    } catch (error) {
      onClozeChange(latestState, version);
      Alert.alert("无法保存挖空", error instanceof Error ? error.message : "请刷新后重试");
    } finally {
      setSavingCloze(false);
    }
  }

  return (
    <>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.date}>{formatDate(detail.dateKey)} · {formatTime(detail.createdAt)}</Text>
      {detail.image ? <Image source={{ uri: detail.image.url }} style={styles.image} resizeMode="cover" /> : null}
      <View style={styles.expressionControls}>
        {clozeState.blanks.length ? (
          <Pressable accessibilityLabel={answersVisible ? "隐藏填空答案" : "查看填空答案"} style={styles.expressionAudio} onPress={() => setAnswersVisible((value) => !value)}>
            <Ionicons name={answersVisible ? "eye-off-outline" : "eye-outline"} size={20} color={theme.colors.textSecondary} />
          </Pressable>
        ) : null}
        <Pressable accessibilityLabel={playing ? "停止播放" : "播放表达"} style={styles.expressionAudio} onPress={() => void play()}>
          <Ionicons name={playing ? "stop-circle-outline" : "volume-high-outline"} size={19} color={theme.colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.rewriteSegments}>
        {detail.rewriteSegments.map((segment) => {
          const segmentBlanks = clozeState.blanks
            .map((blank, index) => blank.segmentId === segment.id ? { blank, index } : null)
            .filter((value): value is { blank: CardClozeState["blanks"][number]; index: number } => Boolean(value));
          return (
            <SelectableMessageText
              key={segment.id}
              text={segment.text}
              style={styles.rewrite}
              enableDictionaryMenu
              enableClozeMenu={!savingCloze}
              highlightRanges={segmentBlanks.map(({ blank, index }) => ({ start: blank.startUtf16, end: blank.endUtf16, groupIndex: index }))}
              blankRanges={answersVisible ? undefined : segmentBlanks.map(({ blank }) => ({ start: blank.startUtf16, end: blank.endUtf16 }))}
              onDictionarySelection={(payload) => lookup(segment, payload)}
              onSelectionChange={(payload) => void addBlank(segment, payload)}
              onClozeRangePress={(index) => {
                const blank = clozeState.blanks[index];
                if (blank) openBlankActions(blank);
              }}
              onClozeRangeLongPress={(index) => {
                const blank = clozeState.blanks[index];
                if (blank) openBlankActions(blank);
              }}
            />
          );
        })}
      </View>
      {savingCloze ? <View style={styles.clozeSaving}><ActivityIndicator size="small" color={theme.colors.accentStrong} /><Text style={styles.selectionHint}>正在保存挖空…</Text></View> : null}
      <View style={styles.divider} />
      <Text selectable style={styles.original}>{detail.originalText}</Text>
      {relations.length ? (
        <View style={styles.relationsSection}>
          <Pressable style={styles.relationsHeader} onPress={() => setShowRelations((value) => !value)}>
            <Text style={styles.relationsSectionTitle}>与这段生活有关</Text>
            <Ionicons name={showRelations ? "chevron-up" : "chevron-down"} size={17} color={theme.colors.textMuted} />
          </Pressable>
          {showRelations ? relations.map((relation) => (
            <Pressable key={relation.recordId} style={styles.relationRow} onPress={() => onOpenRelated?.(relation.recordId, relation.reasons)}>
              <Text numberOfLines={1} style={styles.relationTitle}>{relation.topic || "另一段生活记录"}</Text>
              <Ionicons name="chevron-forward" size={17} color={theme.colors.textMuted} />
            </Pressable>
          )) : null}
        </View>
      ) : null}
    </ScrollView>
    <DictionaryPopover
      visible={Boolean(dictionary)}
      anchor={dictionary?.anchor}
      term={dictionary?.term ?? ""}
      loading={dictionary?.loading ?? false}
      error={dictionary?.error}
      result={dictionary?.result}
      canUseTts={false}
      onClose={() => { dictionaryRequestRef.current += 1; setDictionary(null); }}
    />
    <ClozeTokenEditor
      value={clozeEditor}
      onChange={(selectedTokenIndexes) => setClozeEditor((current) => current ? { ...current, selectedTokenIndexes } : null)}
      onCancel={() => setClozeEditor(null)}
      onConfirm={() => void confirmClozeEditor()}
    />
    </>
  );
}

function ReasonBadge({ reason }: { reason: CardRelationReason }) {
  const label = reason.type === "topic"
    ? "内容相近"
    : reason.type === "phrase"
      ? `${reason.evidence === "clozed" ? "也挖过" : "也出现过"} ${reason.phrase}`
      : `后来主动使用了 ${reason.phrase}`;
  return <View style={[styles.reasonBadge, reason.type === "progress" && styles.reasonProgress, reason.type === "phrase" && styles.reasonPhrase]}><Text style={styles.reasonText}>{label}</Text></View>;
}

function Cloze({ detail, clozeState, clozeVersion, onClozeChange }: {
  detail: CardRecordDetail;
  clozeState: CardClozeState;
  clozeVersion: number;
  onClozeChange: (state: CardClozeState, version: number) => void;
}) {
  const [activeBlankId, setActiveBlankId] = useState<string | null>(clozeState.blanks[0]?.id ?? null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checkedAnswers, setCheckedAnswers] = useState<Record<number, "correct" | "incorrect">>({});
  const [result, setResult] = useState<"correct" | "incorrect" | null>(null);
  const [saving, setSaving] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    setActiveBlankId(clozeState.blanks[0]?.id ?? null);
    setAnswers({});
    setCheckedAnswers({});
    setResult(null);
  }, [detail.id]);
  useEffect(() => {
    setActiveBlankId((current) => clozeState.blanks.some((blank) => blank.id === current) ? current : clozeState.blanks[0]?.id ?? null);
  }, [clozeState.blanks]);
  const activeBlank = clozeState.blanks.find((blank) => blank.id === activeBlankId) ?? null;
  const activeSegment = activeBlank
    ? detail.rewriteSegments.find((segment) => segment.id === activeBlank.segmentId) ?? null
    : null;
  const activeTokens = activeSegment && activeBlank
    ? tokenizeForCloze(activeSegment.text)
    : [];
  const activeBlankTokenIndexes = activeBlank
    ? activeTokens.filter((token) => token.end > activeBlank.startUtf16 && token.start < activeBlank.endUtf16).map((token) => token.index)
    : [];
  const flowSegments = buildClozeFlowSegments({
    tokens: activeTokens,
    phraseTokenIndexes: activeBlankTokenIndexes,
    blankTokenIndexes: activeBlankTokenIndexes,
    correctTokenIndexes: [],
  });

  async function check(): Promise<void> {
    if (!activeBlank || saving) return;
    const nextChecked: Record<number, "correct" | "incorrect"> = {};
    activeTokens.forEach((token) => {
      if (!activeBlankTokenIndexes.includes(token.index)) return;
      nextChecked[token.index] = normalizeAnswer(answers[token.index] ?? "") === normalizeAnswer(token.text) ? "correct" : "incorrect";
    });
    setCheckedAnswers(nextChecked);
    const next = Object.values(nextChecked).length > 0 && Object.values(nextChecked).every((value) => value === "correct") ? "correct" : "incorrect";
    setResult(next);
    setSaving(true);
    try {
      const practice = await saveCardClozeUpdate(detail.id, {
        baseVersion: clozeVersion,
        operation: { type: "result" },
        result: next,
      });
      onClozeChange(asCardClozeState(practice.clozeState), practice.clozeVersion);
    } catch (error) {
      Alert.alert("练习结果未保存", error instanceof Error ? error.message : "请稍后重试");
    } finally { setSaving(false); }
  }

  async function speakBlank(): Promise<void> {
    if (!activeBlank || speaking || detail.source !== "card") return;
    setSpeaking(true);
    try {
      const audio = await getCardSelectionAudio({
        entryId: detail.id.slice("card:".length),
        segmentId: activeBlank.segmentId,
        startUtf16: activeBlank.startUtf16,
        endUtf16: activeBlank.endUtf16,
      });
      await playTtsAudio({ url: audio.audioUrl });
    } finally { setSpeaking(false); }
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.practiceContent}>
      {!clozeState.blanks.length ? (
        <View style={styles.emptyPracticeCard}>
          <Ionicons name="text-outline" size={28} color={theme.colors.accentStrong} />
          <Text style={styles.emptyPracticeTitle}>还没有填空卡片</Text>
          <Text style={styles.practiceHint}>先到“回看”的 OIO 整理中长按选择内容，再点“挖空”。</Text>
        </View>
      ) : (
        <>
          {clozeState.blanks.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blankPicker}>
            {clozeState.blanks.map((blank, index) => <Pressable
              key={blank.id}
              style={[styles.blankPickerItem, blank.id === activeBlankId && styles.blankPickerItemActive]}
              onPress={() => { setActiveBlankId(blank.id); setAnswers({}); setCheckedAnswers({}); setResult(null); }}
            ><Text style={[styles.blankPickerText, blank.id === activeBlankId && styles.blankPickerTextActive]}>第 {index + 1} 题</Text></Pressable>)}
          </ScrollView> : null}
          {activeBlank && activeSegment ? <View style={styles.clozeCard}>
            <View style={styles.clozeFlow}>
              <ClozeTokenFlow
                segments={flowSegments}
                answers={answers}
                checkedAnswers={checkedAnswers}
                onChangeAnswer={(tokenIndex, value) => { setAnswers((current) => ({ ...current, [tokenIndex]: value })); setCheckedAnswers({}); setResult(null); }}
                onBlankFocus={() => undefined}
              />
            </View>
            <Pressable style={styles.clozeAudioButton} disabled={speaking || detail.source !== "card"} onPress={() => void speakBlank()}>
              <Ionicons name="volume-high-outline" size={18} color={theme.colors.accentStrong} />
              <Text style={styles.clozeActionText}>{speaking ? "播放中…" : "播放挖空内容"}</Text>
            </Pressable>
          </View> : null}
          <Pressable style={styles.primaryButton} onPress={() => void check()} disabled={!activeBlankTokenIndexes.some((index) => answers[index]?.trim()) || !activeBlank || saving}><Text style={styles.primaryButtonText}>检查答案</Text></Pressable>
          {result ? <Text style={[styles.result, result === "correct" ? styles.correct : styles.incorrect]}>{result === "correct" ? "答对了" : "再想想，红色部分可以重新练习"}</Text> : null}
        </>
      )}
    </ScrollView>
  );
}

function asCardClozeState(value: unknown): CardClozeState {
  if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1 || !("blanks" in value) || !Array.isArray(value.blanks)) {
    return { schemaVersion: 1, blanks: [] };
  }
  return value as CardClozeState;
}

function Dictation({ detail }: { detail: CardRecordDetail }) {
  const dictation = useMemo(() => selectDictationSentence(detail), [detail.id, detail.rewrittenText]);
  const sentence = dictation.text;
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<"correct" | "incorrect" | null>(null);
  const [saving, setSaving] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  async function playSentence(): Promise<void> {
    const segment = detail.rewriteSegments.find((candidate) => candidate.id === dictation.segmentId);
    if (!segment) return;
    setAudioLoading(true);
    try {
      const audio = await getCardSegmentAudio({
        entryId: detail.id.slice("card:".length),
        segmentId: segment.id,
        sourceKind: "dictation_sentence",
        startUtf16: dictation.startUtf16,
        endUtf16: dictation.endUtf16,
      });
      await playTtsAudio({ url: audio.audioUrl });
    } finally { setAudioLoading(false); }
  }
  async function commit(next: "correct" | "incorrect" | "revealed"): Promise<void> {
    setSaving(true);
    try { await saveCardDictationResult(detail.id, next); } finally { setSaving(false); }
  }
  async function check(): Promise<void> {
    const next = normalizeAnswer(answer) === normalizeAnswer(sentence) ? "correct" : "incorrect";
    setResult(next);
    await commit(next);
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.practiceContent}>
      <Pressable style={styles.audioPlaceholder} disabled={audioLoading} onPress={() => void playSentence()}>{audioLoading ? <ActivityIndicator color={theme.colors.accentStrong} /> : <Ionicons name="volume-high-outline" size={28} color={theme.colors.accentStrong} />}<Text style={styles.audioText}>播放听写句子</Text></Pressable>
      <TextInput multiline value={answer} onChangeText={(value) => { setAnswer(value); setResult(null); }} style={[styles.answerInput, styles.dictationInput]} placeholder="写下你听到的句子" placeholderTextColor={theme.colors.textMuted} textAlignVertical="top" />
      <Pressable style={styles.primaryButton} disabled={!answer.trim() || saving} onPress={() => void check()}>{saving ? <ActivityIndicator color={theme.colors.surface} /> : <Text style={styles.primaryButtonText}>检查听写</Text>}</Pressable>
      <Pressable style={styles.secondaryButton} disabled={saving} onPress={() => { setRevealed(true); void commit("revealed"); }}><Text style={styles.secondaryButtonText}>显示答案</Text></Pressable>
      {result ? <Text style={[styles.result, result === "correct" ? styles.correct : styles.incorrect]}>{result === "correct" ? "完全正确" : "还有一点不一样，可以对照答案再试一次"}</Text> : null}
      {revealed || result === "incorrect" ? <Text selectable style={styles.answerReveal}>{sentence}</Text> : null}
    </ScrollView>
  );
}

function selectDictationSentence(detail: CardRecordDetail): {
  segmentId: string;
  text: string;
  startUtf16: number;
  endUtf16: number;
} {
  const segment = detail.rewriteSegments.find((candidate) => candidate.text.trim()) ?? {
    id: "fallback", text: detail.rewrittenText,
  };
  const leading = segment.text.match(/^\s*/u)?.[0].length ?? 0;
  const available = segment.text.slice(leading);
  const boundaries = graphemeBoundaries(available, 300);
  let end = boundaries[boundaries.length - 1] ?? 0;
  for (const boundary of boundaries) {
    if (boundary > 0 && /[.!?。！？]/u.test(available.slice(boundary - 1, boundary))) {
      end = boundary;
      break;
    }
  }
  return {
    segmentId: segment.id,
    text: available.slice(0, end).trimEnd(),
    startUtf16: leading,
    endUtf16: leading + end,
  };
}

function graphemeBoundaries(value: string, limit: number): number[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => { segment(text: string): Iterable<{ segment: string }> } }).Segmenter;
  if (!Segmenter) {
    let cursor = 0;
    return Array.from(value).slice(0, limit).map((character) => (cursor += character.length));
  }
  let cursor = 0;
  return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(value))
    .slice(0, limit)
    .map(({ segment }) => (cursor += segment.length));
}

function normalizeAnswer(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "").toLocaleLowerCase();
}
function formatDate(value: string): string { const [y, m, d] = value.split("-"); return `${y}年${Number(m)}月${Number(d)}日`; }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

const styles = StyleSheet.create({
  fullscreen: { ...StyleSheet.absoluteFillObject, zIndex: 50, backgroundColor: theme.colors.canvas },
  page: { flex: 1, backgroundColor: theme.colors.canvas },
  header: { height: 54, paddingHorizontal: 8, flexDirection: "row", alignItems: "center" },
  headerButton: { width: 64, minHeight: 44, justifyContent: "center" }, close: { color: theme.colors.textSecondary, fontSize: 15 }, title: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 16, fontWeight: "500" },
  historyButtons: { width: 82, flexDirection: "row", alignItems: "center" },
  historyButton: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  headerEnd: { width: 82, flexDirection: "row", justifyContent: "flex-end" },
  iconHeaderButton: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  draftHeaderSide: { width: 82, minHeight: 44, justifyContent: "center" },
  draftHeaderCenter: { flex: 1 },
  draftHeaderButton: { minWidth: 58, minHeight: 44, alignItems: "center", justifyContent: "center" },
  draftHeaderText: { color: theme.colors.textSecondary, fontSize: 15, fontWeight: "400" },
  loader: { marginTop: 40 }, content: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 52 }, date: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "400" }, image: { width: "100%", aspectRatio: 1.38, borderRadius: 10, marginTop: 24, backgroundColor: theme.colors.surfaceMuted }, sectionLabel: { marginTop: 22, color: theme.colors.textMuted, fontSize: 12, fontWeight: "500" }, original: { marginTop: 16, color: theme.colors.textMuted, fontSize: 14, lineHeight: 23, fontWeight: "400" }, rewrite: { marginTop: 5, color: theme.colors.text, fontFamily: Platform.select({ ios: "Georgia", default: undefined }), fontSize: 20, lineHeight: 32, fontWeight: "400" }, divider: { marginTop: 28, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
  practiceContent: { padding: 20, paddingBottom: 44 }, practiceHint: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 }, answerInput: { marginTop: 18, minHeight: 50, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.control, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 16 }, dictationInput: { minHeight: 120, paddingTop: 13 }, primaryButton: { marginTop: 14, minHeight: 48, borderRadius: theme.radius.control, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accentStrong }, primaryButtonText: { color: theme.colors.surface, fontSize: 15, fontWeight: "600" }, secondaryButton: { marginTop: 10, minHeight: 44, alignItems: "center", justifyContent: "center" }, secondaryButtonText: { color: theme.colors.accentStrong, fontSize: 14 }, result: { marginTop: 16, fontSize: 14, textAlign: "center" }, correct: { color: theme.colors.success }, incorrect: { color: theme.colors.danger }, answerReveal: { marginTop: 16, padding: 14, borderRadius: theme.radius.control, backgroundColor: theme.colors.accentSoft, color: theme.colors.text, fontSize: 16, lineHeight: 24 }, audioPlaceholder: { minHeight: 88, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" }, audioText: { marginTop: 7, color: theme.colors.textMuted, fontSize: 12 },
  selectionHint: { marginTop: 9, color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  expressionControls: { minHeight: 34, paddingTop: 2, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  expressionAudio: { width: 36, height: 36, alignItems: "flex-end", justifyContent: "center" },
  rewriteSegments: { marginTop: 0, gap: 2 },
  clozeSaving: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  emptyPracticeCard: { minHeight: 210, padding: 24, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyPracticeTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  blankPicker: { paddingBottom: 12, gap: 8 },
  blankPickerItem: { minHeight: 34, paddingHorizontal: 13, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  blankPickerItemActive: { backgroundColor: theme.colors.accentSoft },
  blankPickerText: { color: theme.colors.textMuted, fontSize: 12 },
  blankPickerTextActive: { color: theme.colors.accentStrong, fontWeight: "600" },
  clozeCard: { minHeight: 150, padding: 20, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, justifyContent: "center" },
  clozeFlow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  clozeSentence: { color: theme.colors.text, fontSize: 18, lineHeight: 30 },
  clozeGap: { color: theme.colors.accentStrong, fontWeight: "700" },
  clozeAudioButton: { marginTop: 16, alignSelf: "flex-start", minHeight: 36, paddingHorizontal: 11, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSoft, flexDirection: "row", alignItems: "center", gap: 6 },
  clozeActionText: { color: theme.colors.accentStrong, fontSize: 13 },
  inlineAudioButton: { marginTop: 10, alignSelf: "flex-start", minHeight: 36, paddingHorizontal: 11, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSoft, flexDirection: "row", alignItems: "center", gap: 6 }, inlineAudioText: { color: theme.colors.accentStrong, fontSize: 12, fontWeight: "600" },
  imageActions: { marginTop: 10, flexDirection: "row", justifyContent: "flex-end", gap: 18 },
  imageActionText: { color: theme.colors.accentStrong, fontSize: 13 },
  imageRemoveText: { color: theme.colors.danger, fontSize: 13 },
  relationsEntry: { marginTop: 14, minHeight: 48, paddingHorizontal: 13, borderRadius: theme.radius.control, backgroundColor: theme.colors.accentSoft, flexDirection: "row", alignItems: "center", gap: 10 },
  relationsEntryIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  relationsEntryText: { flex: 1, color: theme.colors.accentStrong, fontSize: 14, fontWeight: "700" },
  relationsSection: { marginTop: 34, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  relationsHeader: { minHeight: 40, flexDirection: "row", alignItems: "center" },
  relationsSectionTitle: { flex: 1, color: theme.colors.textSecondary, fontSize: 13, fontWeight: "400" },
  relationRow: { minHeight: 46, flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  relationCard: { marginTop: 10, padding: 14, borderRadius: theme.radius.control, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  relationTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  relationTitle: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  reasonList: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  reasonBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceMuted },
  reasonPhrase: { backgroundColor: theme.colors.accentSoft },
  reasonProgress: { backgroundColor: "#FFF0C9" },
  reasonText: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: "600" },
  draftContent: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 52 },
  draftContentPage: { flex: 1, paddingHorizontal: 22 },
  draftEditorContent: { paddingTop: 10, paddingBottom: 14 },
  draftImage: { width: "100%", aspectRatio: 1.38, marginTop: 18, borderRadius: 10, backgroundColor: theme.colors.surfaceMuted },
  draftImageWrap: { width: "100%", maxHeight: 270, marginTop: 18, borderRadius: 10, overflow: "hidden", backgroundColor: theme.colors.surfaceMuted },
  draftImageFill: { width: "100%", height: "100%" },
  draftImageOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(30,35,38,0.34)", alignItems: "center", justifyContent: "center" },
  draftImageRemove: { position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(30,35,38,0.62)", alignItems: "center", justifyContent: "center" },
  draftInput: { minHeight: 180, marginTop: 18, marginBottom: 24, padding: 0, color: theme.colors.text, fontSize: 18, lineHeight: 30, fontWeight: "400" },
  draftExpressionDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
  draftExpressionPlaceholder: { minHeight: 116, alignItems: "center", justifyContent: "center" },
  draftRewriteButton: { minWidth: 76, minHeight: 40, paddingHorizontal: 18, borderRadius: 10, backgroundColor: "#F2DFC3", alignItems: "center", justifyContent: "center" },
  draftRewriteButtonDisabled: { opacity: 0.35 },
  draftRewriteButtonText: { color: theme.colors.accentStrong, fontSize: 13, fontWeight: "500" },
  cardPageToolbar: { minHeight: 52, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.canvas, flexDirection: "row", alignItems: "center" },
  draftToolButton: { width: 42, height: 44, alignItems: "flex-start", justifyContent: "center" },
  draftToolbarSpacer: { flex: 1 },
  practiceToolButton: { flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 3 },
  practiceToolText: { color: theme.colors.textMuted, fontSize: 10, fontWeight: "400" },
  practiceToolTextActive: { color: theme.colors.accentStrong, fontWeight: "500" },
  draftImageError: { color: theme.colors.danger, fontSize: 12 },
  draftCounter: { color: theme.colors.textMuted, fontSize: 12 },
  draftCounterError: { color: theme.colors.danger },
  photoRail: { maxHeight: 92, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  photoRailContent: { paddingVertical: 10, gap: 8 },
  photoRailItem: { width: 72, height: 72, borderRadius: 8, overflow: "hidden", backgroundColor: theme.colors.surfaceMuted },
  photoRailImage: { width: "100%", height: "100%" },
  photoRailAll: { width: 82, height: 72, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center", gap: 5 },
  photoRailAllText: { color: theme.colors.textSecondary, fontSize: 11 },
  draftProcessingLines: { paddingTop: 22, gap: 10 },
  draftProcessingLineLong: { width: "78%", height: 2, borderRadius: 1, backgroundColor: theme.colors.border },
  draftProcessingLineShort: { width: "52%", height: 2, borderRadius: 1, backgroundColor: theme.colors.border },
});
