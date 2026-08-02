import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  ActionSheetIOS,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createCardEntry,
  bootstrapCard,
  createCardCollection,
  deleteCardCollection,
  deleteCardRecord,
  getCardCollections,
  getCardRecords,
  getCardTaskStatus,
  moveCardToCollection,
  moveCardCollection,
  renameCardCollection,
  setCardCollectionFavorite,
  CardApiError,
  deleteCardImageUpload,
  replaceCardRecordImage,
  removeCardRecordImage,
  searchCardsLexically,
  type CardRecordSummary,
  type CardCollection,
  type RecallCandidate,
} from "../services/api/cardApi";
import {
  clearCardDraft,
  loadCardDraft,
  saveCardDraft,
  type CardDraft,
} from "../services/card/cardDraftStorage";
import { theme } from "../theme";
import { CardDetailModal } from "./CardDetailModal";
import {
  prepareCardDraftImage,
  removePersistentDraftImage,
  uploadCardDraftImage,
} from "../services/card/cardImageUpload";

type MainScreenProps = {
  isActive: boolean;
  refreshRevision: number;
  onOpenCard: (recordId: string) => void;
  onOpenRecall: () => void;
  onOpenAccount: () => void;
};
type LibraryView = "unclassified" | string;

const EMPTY_DRAFT: CardDraft = { text: "", clientId: null, recordId: null, submitted: false, image: null };
const LIBRARY_PAGE_SIZE = 40;

export function MainScreen({ isActive, refreshRevision, onOpenCard, onOpenRecall, onOpenAccount }: MainScreenProps) {
  const [libraryView, setLibraryView] = useState<LibraryView>("unclassified");
  const [records, setRecords] = useState<CardRecordSummary[]>([]);
  const [collections, setCollections] = useState<CardCollection[]>([]);
  const [unclassifiedCount, setUnclassifiedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchResults, setSearchResults] = useState<RecallCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [composerVisible, setComposerVisible] = useState(false);
  const [collectionMoveVisible, setCollectionMoveVisible] = useState(false);
  const [collectionMoveTargetId, setCollectionMoveTargetId] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [draft, setDraft] = useState<CardDraft>(EMPTY_DRAFT);
  const [sending, setSending] = useState(false);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const pollStartedAtRef = useRef(Date.now());
  const refreshSequenceRef = useRef(0);
  const searchSequenceRef = useRef(0);
  const submitInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current;
    setLoading(true);
    try {
      const collectionId = libraryView === "unclassified" ? undefined : libraryView;
      const [rows, collectionResult] = await Promise.all([
        getCardRecords({
          collectionId,
          unclassified: libraryView === "unclassified",
          limit: LIBRARY_PAGE_SIZE,
        }),
        getCardCollections(),
      ]);
      if (sequence !== refreshSequenceRef.current) return;
      setRecords(rows);
      setCollections(collectionResult.collections);
      setUnclassifiedCount(collectionResult.unclassifiedCount);
      setHasMore(rows.length === LIBRARY_PAGE_SIZE);
    } catch {
      if (sequence !== refreshSequenceRef.current) return;
      Alert.alert("暂时无法加载", "请检查网络后重试");
    } finally {
      if (sequence === refreshSequenceRef.current) setLoading(false);
    }
  }, [libraryView]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore || searchResults) return;
    setLoadingMore(true);
    try {
      const collectionId = libraryView === "unclassified" ? undefined : libraryView;
      const rows = await getCardRecords({
        collectionId,
        unclassified: libraryView === "unclassified",
        limit: LIBRARY_PAGE_SIZE,
        offset: records.length,
      });
      setRecords((current) => [...current, ...rows.filter((row) => !current.some((item) => item.id === row.id))]);
      setHasMore(rows.length === LIBRARY_PAGE_SIZE);
    } catch {
      // Keep the current archive visible; the next scroll can retry.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, libraryView, loading, loadingMore, records.length, searchResults]);

  useEffect(() => {
    let cancelled = false;
    void loadCardDraft().then(async (saved) => {
      if (cancelled) return;
      await bootstrapCard().catch(() => []);
      const restored = saved;
      if (cancelled) return;
      setDraft(restored);
      if (restored.image && restored.image.status !== "ready" && restored.image.status !== "failed") {
        void processDraftImage(restored.image);
      }
      if (restored.submitted && restored.recordId) {
        setActiveRecordId(restored.recordId);
        pollStartedAtRef.current = Date.now();
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isActive) void refresh();
  }, [isActive, refresh, refreshRevision]);

  useEffect(() => {
    if (!isActive || !activeRecordId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled || AppState.currentState !== "active") return;
      try {
        const task = await getCardTaskStatus(activeRecordId);
        if (cancelled) return;
        if (task.status === "completed") {
          const completedRecordId = activeRecordId;
          if (composerVisible) {
            setComposerVisible(false);
            onOpenCard(completedRecordId);
          }
          if (draft.image) removePersistentDraftImage(draft.image.localUri);
          setActiveRecordId(null);
          setDraft(EMPTY_DRAFT);
          await clearCardDraft();
          await refresh();
          return;
        }
        if (task.status === "failed") {
          const restored = {
            ...draft,
            clientId: null,
            submitted: false,
            recordId: null,
            image: draft.image ? { ...draft.image, uploadId: null, status: "pending" as const } : null,
          };
          setActiveRecordId(null);
          setDraft(restored);
          await saveCardDraft(restored);
          if (restored.image) void processDraftImage(restored.image);
          await refresh();
      Alert.alert("保存失败", "请稍后重试");
          return;
        }
      } catch (error) {
        if (error instanceof CardApiError && error.status === 404) {
          const restored = {
            ...draft,
            clientId: null,
            submitted: false,
            recordId: null,
            image: draft.image ? { ...draft.image, uploadId: null, status: "pending" as const } : null,
          };
          setActiveRecordId(null);
          setDraft(restored);
          await saveCardDraft(restored);
          if (restored.image) void processDraftImage(restored.image);
          return;
        }
      }
      const elapsed = Date.now() - pollStartedAtRef.current;
      timer = setTimeout(poll, elapsed < 30_000 ? 2_000 : 5_000);
    };

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void poll();
      else if (timer) clearTimeout(timer);
    });
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [activeRecordId, composerVisible, draft, isActive, onOpenCard, refresh]);

  async function updateDraftText(text: string): Promise<void> {
    const next = { ...draft, text, submitted: false, recordId: null };
    setDraft(next);
    await saveCardDraft(next);
  }

  async function submit(): Promise<void> {
    if (submitInFlightRef.current) return;
    const text = draft.text.trim();
    const count = countGraphemes(text);
    if (count < 1 || count > 3_000) {
      Alert.alert("暂时无法保存", "请输入 1–3000 个字符");
      return;
    }
    const clientId = draft.clientId ?? Crypto.randomUUID();
    if (draft.image && draft.image.status !== "ready") {
      Alert.alert(
        draft.image.status === "failed" ? "图片处理失败" : "图片还没准备好",
        draft.image.status === "failed"
          ? "请移除图片后保存，或换一张图片再试"
          : "请等待图片上传和审核完成，或先移除图片",
      );
      return;
    }
    const submitting = { ...draft, text: draft.text, clientId, recordId: null, submitted: true };
    submitInFlightRef.current = true;
    setSending(true);
    setDraft(submitting);
    await saveCardDraft(submitting);
    try {
      const created = await createCardEntry({ clientId, originalText: text, imageUploadId: draft.image?.uploadId ?? null });
      const createdForDisplay = draft.image && !created.thumbnail
        ? {
            ...created,
            thumbnail: {
              url: draft.image.localUri,
              width: draft.image.width,
              height: draft.image.height,
            },
          }
        : created;
      const accepted = { ...submitting, recordId: created.id };
      setDraft(accepted);
      await saveCardDraft(accepted);
      if (libraryView === "unclassified") {
        refreshSequenceRef.current += 1;
        setLoading(false);
        setRecords((current) => [createdForDisplay, ...current.filter((row) => row.id !== created.id)]);
      } else {
        setLibraryView("unclassified");
      }
      setActiveRecordId(created.id);
      pollStartedAtRef.current = Date.now();
    } catch (error) {
      console.warn("[card] create entry failed", error);
      const retryable = {
        ...submitting,
        clientId: error instanceof CardApiError && error.code === "CARD_CLIENT_ID_CONSUMED"
          ? null
          : submitting.clientId,
        submitted: false,
      };
      setDraft(retryable);
      await saveCardDraft(retryable);
      Alert.alert(
        error instanceof CardApiError && error.code === "TASK_IN_PROGRESS" ? "仍在整理" : "暂时无法发送",
        error instanceof CardApiError && error.code === "TASK_IN_PROGRESS"
          ? "当前已有一条内容正在整理"
          : "草稿已保留，请稍后重试",
      );
    } finally {
      submitInFlightRef.current = false;
      setSending(false);
    }
  }

  function persistDraftImage(image: CardDraft["image"]): void {
    setDraft((current) => {
      const next = { ...current, image };
      void saveCardDraft(next);
      return next;
    });
  }

  async function processDraftImage(image: NonNullable<CardDraft["image"]>): Promise<void> {
    try {
      const ready = await uploadCardDraftImage(image, persistDraftImage);
      persistDraftImage(ready);
    } catch (error) {
      console.warn("[card] image upload failed", error);
      setDraft((current) => {
        const next = {
          ...current,
          image: current.image?.localUri === image.localUri
            ? { ...current.image, status: "failed" as const }
            : current.image,
        };
        void saveCardDraft(next);
        return next;
      });
    }
  }

  async function pickImage(source: "camera" | "library"): Promise<void> {
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
    await applyDraftImage(selected);
  }

  async function applyDraftImage(selected: { uri: string; width: number; height: number }): Promise<void> {
    try {
      if (draft.image) {
        if (draft.image.uploadId) void deleteCardImageUpload(draft.image.uploadId).catch(() => undefined);
        removePersistentDraftImage(draft.image.localUri);
      }
      const prepared = await prepareCardDraftImage({ uri: selected.uri, width: selected.width, height: selected.height });
      persistDraftImage(prepared);
      void processDraftImage(prepared);
    } catch {
      Alert.alert("无法处理图片", "请换一张图片再试");
    }
  }

  function removeDraftImage(): void {
    const image = draft.image;
    if (!image) return;
    persistDraftImage(null);
    removePersistentDraftImage(image.localUri);
    if (image.uploadId) void deleteCardImageUpload(image.uploadId).catch(() => undefined);
  }

  function openDetail(record: CardRecordSummary): void {
    if (record.status !== "completed") {
      Alert.alert("仍在整理", "OIO 正在整理这条记录");
      return;
    }
    onOpenCard(record.id);
  }

  async function submitSearch(): Promise<void> {
    const query = searchQuery.trim();
    if (!query) {
      clearSearch();
      return;
    }
    const sequence = ++searchSequenceRef.current;
    setSearching(true);
    try {
      const collectionId = libraryView === "unclassified"
          ? "unclassified"
          : libraryView;
      const rows = await searchCardsLexically({ q: query, collectionId, limit: 50 });
      if (sequence === searchSequenceRef.current) setSearchResults(rows);
    } catch {
      if (sequence === searchSequenceRef.current) {
        Alert.alert("搜索失败", "请检查网络后重试");
      }
    } finally {
      if (sequence === searchSequenceRef.current) setSearching(false);
    }
  }

  function clearSearch(): void {
    searchSequenceRef.current += 1;
    setSearchQuery("");
    setSearchResults(null);
    setSearching(false);
  }

  function selectLibraryView(view: LibraryView): void {
    clearSearch();
    setLibraryView(view);
  }

  function confirmDelete(recordId: string): void {
    Alert.alert("删除这条记录？", "删除后无法恢复", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => void deleteCardRecord(recordId).then(() => {
          setRecords((rows) => rows.filter((row) => row.id !== recordId));
        }).catch(() => Alert.alert("删除失败", "请稍后重试")),
      },
    ]);
  }

  function openRecordActions(record: CardRecordSummary): void {
    if (record.source !== "card") {
      confirmDelete(record.id);
      return;
    }
    Alert.alert("记录操作", undefined, [
      { text: "移动到", onPress: () => openMoveActions(record) },
      { text: record.thumbnail ? "更换图片" : "添加图片", onPress: () => void chooseRecordImage(record.id) },
      ...(record.thumbnail ? [{ text: "移除图片", style: "destructive" as const, onPress: () => confirmRemoveRecordImage(record.id) }] : []),
      { text: "删除记录", style: "destructive", onPress: () => confirmDelete(record.id) },
      { text: "取消", style: "cancel" },
    ]);
  }

  function openMoveActions(record: CardRecordSummary): void {
    Alert.alert("移动到", undefined, [
      { text: "未分类", onPress: () => void moveRecord(record, null) },
      ...collections.map((collection) => ({
        text: collectionPathName(collection, collections),
        onPress: () => void moveRecord(record, collection.id),
      })),
      { text: "取消", style: "cancel" },
    ]);
  }

  async function moveRecord(record: CardRecordSummary, collectionId: string | null): Promise<void> {
    try {
      await moveCardToCollection(record.id, collectionId);
      await refresh();
    } catch {
      Alert.alert("移动失败", "请稍后重试");
    }
  }

  async function saveCollection(name: string, collectionId?: string, parentId: string | null = null): Promise<void> {
    if (collectionId) await renameCardCollection(collectionId, name);
    else await createCardCollection(name, parentId);
    await refresh();
  }

  async function removeCollection(collection: CardCollection): Promise<void> {
    await deleteCardCollection(collection.id);
    if (libraryView === collection.id) setLibraryView("all");
    await refresh();
  }

  async function moveCollection(collectionId: string, parentId: string | null, position?: number): Promise<void> {
    await moveCardCollection(collectionId, parentId, position);
    await refresh();
  }

  async function toggleCollectionFavorite(collection: CardCollection): Promise<void> {
    await setCardCollectionFavorite(collection.id, !collection.isFavorite);
    await refresh();
  }

  async function chooseRecordImage(recordId: string): Promise<void> {
    Alert.alert("选择图片", undefined, [
      { text: "拍照", onPress: () => void pickRecordImage(recordId, "camera") },
      { text: "从相册选择", onPress: () => void pickRecordImage(recordId, "library") },
      { text: "取消", style: "cancel" },
    ]);
  }

  async function pickRecordImage(recordId: string, source: "camera" | "library"): Promise<void> {
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
      prepared = await prepareCardDraftImage({ uri: selected.uri, width: selected.width, height: selected.height });
      const ready = await uploadCardDraftImage(prepared, () => undefined);
      if (!ready.uploadId) throw new Error("图片上传没有完成");
      unclaimedUploadId = ready.uploadId;
      await replaceCardRecordImage(recordId, ready.uploadId);
      unclaimedUploadId = null;
      await refresh();
    } catch (error) {
      if (unclaimedUploadId) void deleteCardImageUpload(unclaimedUploadId).catch(() => undefined);
      Alert.alert("无法更换图片", error instanceof Error ? error.message : "原图片已保留，请稍后重试");
    } finally {
      if (prepared) removePersistentDraftImage(prepared.localUri);
      setLoading(false);
    }
  }

  function confirmRemoveRecordImage(recordId: string): void {
    Alert.alert("移除这张图片？", "文字记录会继续保留", [
      { text: "取消", style: "cancel" },
      { text: "移除", style: "destructive", onPress: () => void removeCardRecordImage(recordId).then(async () => {
        await refresh();
      }).catch(() => Alert.alert("移除失败", "原图片已保留，请稍后重试")) },
    ]);
  }

  const activeCollection = collections.find((collection) => collection.id === libraryView);
  const headerTitle = libraryView === "unclassified"
        ? "未分类"
        : activeCollection?.name ?? "未分类";

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.brandRow}>
        <Pressable accessibilityLabel="打开导航" style={styles.headerIconButton} onPress={() => {
          Keyboard.dismiss();
          setSidebarVisible(true);
        }}>
          <Ionicons name="menu-outline" size={27} color={theme.colors.text} />
        </Pressable>
        <Text numberOfLines={1} style={styles.brand}>{headerTitle}</Text>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="搜索生活记录" style={styles.headerIconButton} onPress={() => setSearchVisible((visible) => !visible)}>
            <Ionicons name="search-outline" size={23} color={theme.colors.text} />
          </Pressable>
        </View>
      </View>

      {searchVisible || searchQuery || searchResults ? <View style={styles.searchRow}>
        <Ionicons name="search" size={19} color={theme.colors.textMuted} />
        <TextInput
          value={searchQuery}
          onChangeText={(value) => {
            setSearchQuery(value);
            if (searchResults !== null) setSearchResults(null);
          }}
          onSubmitEditing={() => void submitSearch()}
          returnKeyType="search"
          placeholder="搜索一段生活或表达"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.searchInput}
        />
        {searchQuery ? (
          <Pressable accessibilityLabel="清空搜索" hitSlop={8} onPress={clearSearch}>
            <Ionicons name="close-circle" size={20} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
        <Pressable accessibilityLabel="搜索" style={styles.searchSubmit} disabled={searching} onPress={() => void submitSearch()}>
          {searching
            ? <ActivityIndicator size="small" color={theme.colors.surface} />
            : <Ionicons name="arrow-forward" size={19} color={theme.colors.surface} />}
        </Pressable>
      </View> : null}
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={200}
        onScroll={({ nativeEvent }) => {
          const distance = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
          if (distance < 320) void loadMore();
        }}
      >
        {searchResults ? (
          <>
            <Text style={styles.searchSummary}>
              关于“{searchQuery.trim()}”的生活片段
            </Text>
            {searchResults.map((result) => (
              <SearchResultCard
                key={result.recordId}
                result={result}
                onPress={() => onOpenCard(result.recordId)}
              />
            ))}
            {!searchResults.length ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>没有找到直接匹配</Text>
                <Text style={styles.emptyText}>这里查找的是实际出现过的单词、短语和词形</Text>
              </View>
            ) : null}
          </>
        ) : null}
        {!searchResults && loading ? <ActivityIndicator color={theme.colors.accentStrong} style={styles.loader} /> : null}
        {!searchResults && !loading && !records.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{libraryView === "all" ? "你的生活，会从这里慢慢留下来" : "这个生活集还没有故事"}</Text>
            <Text style={styles.emptyText}>{libraryView === "all" ? "一场雨、一次见面，或者一个没有答案的念头。" : "可以把相关的生活记录收进这里。"}</Text>
            <Pressable style={styles.emptyAction} onPress={() => setComposerVisible(true)}>
              <Text style={styles.emptyActionText}>制作第一张卡片</Text>
            </Pressable>
          </View>
        ) : !searchResults && records.map((record) => (
          <CardCard key={record.id} record={record} onPress={() => void openDetail(record)} onDelete={() => openRecordActions(record)} />
        ))}
        {!searchResults && loadingMore ? <ActivityIndicator color={theme.colors.accentStrong} style={styles.loadMoreIndicator} /> : null}

      </ScrollView>
      <Pressable accessibilityLabel="制作卡片" style={styles.floatingRecordButton} onPress={() => setComposerVisible(true)}>
        <Ionicons name="create-outline" size={24} color={theme.colors.text} />
      </Pressable>

      {composerVisible ? (
        <CardDetailModal
          detail={null}
          loading={false}
          draft={{ value: draft, sending }}
          onClose={() => setComposerVisible(false)}
          onDraftChange={(value) => void updateDraftText(value)}
          onDraftGenerate={() => void submit()}
          onDraftChooseImage={() => void pickImage("library")}
          onDraftTakePhoto={() => void pickImage("camera")}
          onDraftSelectImage={(asset) => void applyDraftImage(asset)}
          onDraftRemoveImage={removeDraftImage}
        />
      ) : null}
      <CollectionMoveModal
        visible={collectionMoveVisible}
        collections={collections}
        collectionId={collectionMoveTargetId}
        onClose={() => {
          setCollectionMoveVisible(false);
          setCollectionMoveTargetId(null);
        }}
        onMove={moveCollection}
      />
      <LibrarySidebar
        visible={sidebarVisible}
        activeView={libraryView}
        collections={collections}
        unclassifiedCount={unclassifiedCount}
        onClose={() => setSidebarVisible(false)}
        onSelect={(view) => {
          selectLibraryView(view);
        }}
        onOpenRecall={() => {
          setSidebarVisible(false);
          setTimeout(onOpenRecall, 240);
        }}
        onCreateCollection={(name, parentId) => saveCollection(name, undefined, parentId)}
        onRenameCollection={(collectionId, name) => saveCollection(name, collectionId)}
        onToggleFavorite={toggleCollectionFavorite}
        onDeleteCollection={removeCollection}
        onRequestMoveCollection={(collectionId) => {
          setSidebarVisible(false);
          setCollectionMoveTargetId(collectionId);
          setTimeout(() => setCollectionMoveVisible(true), 240);
        }}
        onOpenAccount={() => {
          setSidebarVisible(false);
          setTimeout(onOpenAccount, 240);
        }}
      />
    </SafeAreaView>
  );
}

function LibrarySidebar({ visible, activeView, collections, unclassifiedCount, onClose, onSelect, onOpenRecall, onCreateCollection, onRenameCollection, onToggleFavorite, onDeleteCollection, onRequestMoveCollection, onOpenAccount }: {
  visible: boolean;
  activeView: LibraryView;
  collections: CardCollection[];
  unclassifiedCount: number;
  onClose: () => void;
  onSelect: (view: LibraryView) => void;
  onOpenRecall: () => void;
  onCreateCollection: (name: string, parentId: string | null) => Promise<void>;
  onRenameCollection: (collectionId: string, name: string) => Promise<void>;
  onToggleFavorite: (collection: CardCollection) => Promise<void>;
  onDeleteCollection: (collection: CardCollection) => Promise<void>;
  onRequestMoveCollection: (collectionId: string) => void;
  onOpenAccount: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [savingCollection, setSavingCollection] = useState(false);
  const [renamingCollectionId, setRenamingCollectionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(new Set());
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const [collectionsExpanded, setCollectionsExpanded] = useState(true);
  const [favoriteSavingId, setFavoriteSavingId] = useState<string | null>(null);
  const suppressNextCollectionPressRef = useRef<string | null>(null);
  const favoriteCollections = collections.filter((collection) => collection.isFavorite);

  async function toggleFavorite(collection: CardCollection): Promise<void> {
    if (favoriteSavingId) return;
    setFavoriteSavingId(collection.id);
    try {
      await onToggleFavorite(collection);
    } catch (error) {
      Alert.alert("无法更新收藏", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setFavoriteSavingId(null);
    }
  }

  function confirmDeleteCollection(collection: CardCollection): void {
    Alert.alert("删除这个生活集？", "其子生活集也会删除，其中的生活记录会回到未分类，但记录本身不会删除。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => void onDeleteCollection(collection).catch(() => Alert.alert("删除失败", "请稍后重试")),
      },
    ]);
  }

  function runCollectionAction(collection: CardCollection, index: number): void {
    if (index === 0) void toggleFavorite(collection);
    else if (index === 1) beginCreating(collection.id);
    else if (index === 2) beginRenaming(collection);
    else if (index === 3) onRequestMoveCollection(collection.id);
    else if (index === 4) confirmDeleteCollection(collection);
  }

  function openCollectionActions(collection: CardCollection): void {
    const options = [
      collection.isFavorite ? "取消收藏" : "收藏",
      "新建子生活集",
      "重命名",
      "移动到",
      "删除",
      "取消",
    ];
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 5, destructiveButtonIndex: 4, title: collection.name },
        (index) => {
          if (index < 5) runCollectionAction(collection, index);
        },
      );
      return;
    }
    Alert.alert(collection.name, undefined, [
      { text: options[0], onPress: () => runCollectionAction(collection, 0) },
      { text: options[1], onPress: () => runCollectionAction(collection, 1) },
      { text: options[2], onPress: () => runCollectionAction(collection, 2) },
      { text: options[3], onPress: () => runCollectionAction(collection, 3) },
      { text: options[4], style: "destructive", onPress: () => runCollectionAction(collection, 4) },
      { text: "取消", style: "cancel" },
    ]);
  }

  async function createCollection(): Promise<void> {
    const name = newCollectionName.trim();
    if (!name || savingCollection) return;
    setSavingCollection(true);
    try {
      await onCreateCollection(name, creatingParentId ?? null);
      if (creatingParentId) {
        setExpandedCollectionIds((current) => new Set(current).add(creatingParentId));
      }
      setNewCollectionName("");
      setCreatingParentId(undefined);
    } catch (error) {
      Alert.alert("无法新建生活集", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setSavingCollection(false);
    }
  }

  function beginCreating(parentId: string | null): void {
    setCreatingParentId(parentId);
    setNewCollectionName("");
    if (parentId) setExpandedCollectionIds((current) => new Set(current).add(parentId));
  }

  function beginRenaming(collection: CardCollection): void {
    setCreatingParentId(undefined);
    setNewCollectionName("");
    setRenamingCollectionId(collection.id);
    setRenameValue(collection.name);
  }

  function cancelRenaming(): void {
    setRenamingCollectionId(null);
    setRenameValue("");
  }

  async function submitRename(): Promise<void> {
    const name = renameValue.trim();
    if (!renamingCollectionId || !name || savingRename) return;
    setSavingRename(true);
    try {
      await onRenameCollection(renamingCollectionId, name);
      cancelRenaming();
    } catch (error) {
      Alert.alert("无法重命名生活集", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setSavingRename(false);
    }
  }

  function toggleExpanded(collectionId: string): void {
    setExpandedCollectionIds((current) => {
      const next = new Set(current);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  }

  function renderCreateRow(depth: number) {
    return (
      <View style={[styles.sidebarCreateRow, { marginLeft: 6 + Math.min(depth, 2) * 18 }]}>
        <TextInput
          autoFocus
          value={newCollectionName}
          onChangeText={setNewCollectionName}
          onSubmitEditing={() => void createCollection()}
          editable={!savingCollection}
          maxLength={60}
          returnKeyType="done"
          placeholder={creatingParentId ? "子生活集名称" : "生活集名称"}
          placeholderTextColor={theme.colors.textMuted}
          style={styles.sidebarCreateInput}
        />
        <Pressable accessibilityLabel="完成新建生活集" disabled={!newCollectionName.trim() || savingCollection} hitSlop={8} onPress={() => void createCollection()}>
          {savingCollection
            ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            : <Ionicons name="checkmark-outline" size={22} color={newCollectionName.trim() ? theme.colors.text : theme.colors.textMuted} />}
        </Pressable>
        <Pressable
          accessibilityLabel="取消新建生活集"
          disabled={savingCollection}
          hitSlop={8}
          onPress={() => {
            setCreatingParentId(undefined);
            setNewCollectionName("");
          }}
        >
          <Ionicons name="close-outline" size={22} color={theme.colors.textMuted} />
        </Pressable>
      </View>
    );
  }

  function renderCollectionTree(parentId: string | null, depth: number): React.ReactNode {
    return collections.filter((collection) => collection.parentId === parentId).map((collection) => {
      const children = collections.filter((candidate) => candidate.parentId === collection.id);
      const expanded = expandedCollectionIds.has(collection.id);
      return (
        <React.Fragment key={collection.id}>
          {renamingCollectionId === collection.id ? (
            <View style={[styles.sidebarCreateRow, { marginLeft: 6 + Math.min(depth, 2) * 18 }]}>
              <TextInput
                autoFocus
                value={renameValue}
                onChangeText={setRenameValue}
                onSubmitEditing={() => void submitRename()}
                editable={!savingRename}
                maxLength={60}
                returnKeyType="done"
                selectTextOnFocus
                style={styles.sidebarCreateInput}
              />
              <Pressable accessibilityLabel="确认重命名" disabled={!renameValue.trim() || savingRename} hitSlop={8} onPress={() => void submitRename()}>
                {savingRename
                  ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                  : <Ionicons name="checkmark-outline" size={22} color={renameValue.trim() ? theme.colors.text : theme.colors.textMuted} />}
              </Pressable>
              <Pressable accessibilityLabel="取消重命名" disabled={savingRename} hitSlop={8} onPress={cancelRenaming}>
                <Ionicons name="close-outline" size={22} color={theme.colors.textMuted} />
              </Pressable>
            </View>
          ) : (
            <SidebarRow
              label={collection.name}
              selected={activeView === collection.id}
              depth={depth}
              expandable={children.length > 0}
              expanded={expanded}
              onToggle={() => toggleExpanded(collection.id)}
              onMore={() => openCollectionActions(collection)}
              onLongPress={() => {
                suppressNextCollectionPressRef.current = collection.id;
                openCollectionActions(collection);
              }}
              onPress={() => {
                if (suppressNextCollectionPressRef.current === collection.id) {
                  suppressNextCollectionPressRef.current = null;
                  return;
                }
                onSelect(collection.id);
              }}
            />
          )}
          {creatingParentId === collection.id ? renderCreateRow(depth + 1) : null}
          {expanded ? renderCollectionTree(collection.id, depth + 1) : null}
        </React.Fragment>
      );
    });
  }

  return (
    <AnimatedSidebarModal visible={visible} onRequestClose={onClose}>
        <View style={[styles.sidebar, { paddingTop: Math.max(insets.top, 12), paddingBottom: insets.bottom }]}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarBrand}>OIO</Text>
            <Pressable accessibilityLabel="关闭导航" style={styles.headerIconButton} onPress={onClose}>
              <Ionicons name="close-outline" size={25} color={theme.colors.text} />
            </Pressable>
          </View>
          <View style={styles.sidebarFixedContent}>
            <SidebarRow icon="sparkles-outline" label="回忆" onPress={onOpenRecall} />
            <View style={styles.sidebarDivider} />
            <SidebarRow icon="settings-outline" label="设置" onPress={onOpenAccount} />
            <SidebarRow icon="person-circle-outline" label="我的账号" onPress={onOpenAccount} />
          </View>

          <View style={styles.sidebarCollectionSection}>
            <ScrollView
              style={styles.sidebarCollectionScroller}
              contentContainerStyle={styles.sidebarCollectionContent}
              alwaysBounceVertical={false}
              bounces={collections.length > 7}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.sidebarSectionHeader}>
                <Pressable
                  accessibilityLabel={favoritesExpanded ? "收起收藏夹" : "展开收藏夹"}
                  style={styles.sidebarSectionToggle}
                  onPress={() => setFavoritesExpanded((expanded) => !expanded)}
                >
                  <Ionicons name={favoritesExpanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} />
                  <Text style={styles.sidebarSectionTitle}>收藏夹</Text>
                </Pressable>
              </View>
              {favoritesExpanded ? (
                <>
                  {favoriteCollections.map((collection) => (
                    <SidebarRow
                      key={`favorite-${collection.id}`}
                      label={collection.name}
                      selected={activeView === collection.id}
                      onPress={() => onSelect(collection.id)}
                    />
                  ))}
                </>
              ) : null}

              <View style={[styles.sidebarSectionHeader, styles.sidebarLifeSectionHeader]}>
                <Pressable
                  accessibilityLabel={collectionsExpanded ? "收起生活集" : "展开生活集"}
                  style={styles.sidebarSectionToggle}
                  onPress={() => setCollectionsExpanded((expanded) => !expanded)}
                >
                  <Ionicons name={collectionsExpanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} />
                  <Text style={styles.sidebarSectionTitle}>生活集</Text>
                </Pressable>
                <View style={styles.sidebarSectionActions}>
                  <Pressable
                    accessibilityLabel={creatingParentId === null ? "取消新建生活集" : "新建生活集"}
                    style={styles.sidebarSectionAction}
                    hitSlop={8}
                    onPress={() => {
                      if (creatingParentId === null) {
                        setCreatingParentId(undefined);
                        setNewCollectionName("");
                      } else {
                        setCollectionsExpanded(true);
                        beginCreating(null);
                      }
                    }}
                  >
                    <Ionicons name={creatingParentId === null ? "close-outline" : "add-outline"} size={23} color={theme.colors.text} />
                  </Pressable>
                </View>
              </View>
              {collectionsExpanded ? (
                <>
                  <SidebarRow
                    icon="file-tray-outline"
                    label="未分类"
                    count={unclassifiedCount}
                    selected={activeView === "unclassified"}
                    onPress={() => onSelect("unclassified")}
                  />
                  {creatingParentId === null ? renderCreateRow(0) : null}
                  {renderCollectionTree(null, 0)}
                  {!collections.length ? <Text style={styles.sidebarEmpty}>把相关的生活记录收进同一个章节。</Text> : null}
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
    </AnimatedSidebarModal>
  );
}

function AnimatedSidebarModal({ visible, onRequestClose, children }: {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(visible);
  const translateX = useRef(new Animated.Value(-380)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(translateX, { toValue: 0, damping: 24, stiffness: 240, mass: 0.9, useNativeDriver: true }),
          Animated.timing(scrimOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start();
      });
      return;
    }
    if (!mounted) return;
    Animated.parallel([
      Animated.timing(translateX, { toValue: -380, duration: 210, useNativeDriver: true }),
      Animated.timing(scrimOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [mounted, scrimOpacity, translateX, visible]);

  if (!mounted) return null;
  return (
    <View style={styles.sidebarOverlay}>
      <Animated.View style={[styles.sidebarAnimatedScrim, { opacity: scrimOpacity }]}>
        <Pressable accessibilityLabel="关闭导航" style={StyleSheet.absoluteFill} onPress={onRequestClose} />
      </Animated.View>
      <Animated.View style={[styles.sidebarAnimatedContent, { transform: [{ translateX }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

function SidebarRow({ icon, label, count, selected = false, onPress, onLongPress, depth = 0, expandable = false, expanded = false, onToggle, onMore }: {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  count?: number;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  depth?: number;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onMore?: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.sidebarRow,
        { paddingLeft: 14 + Math.min(depth, 2) * 18 },
        selected && styles.sidebarRowSelected,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <Pressable accessibilityLabel={expanded ? "折叠生活集" : "展开生活集"} disabled={!expandable} style={styles.sidebarDisclosure} onPress={(event) => { event.stopPropagation(); onToggle?.(); }}>
        {expandable ? <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} /> : null}
      </Pressable>
      {icon ? <Ionicons name={icon} size={22} color={selected ? theme.colors.text : theme.colors.textSecondary} /> : null}
      <Text numberOfLines={1} style={[styles.sidebarRowLabel, selected && styles.sidebarRowLabelSelected]}>{label}</Text>
      {count !== undefined ? <Text style={styles.sidebarRowCount}>{count}</Text> : null}
      {onMore ? (
        <Pressable
          accessibilityLabel={`${label}的更多操作`}
          style={styles.sidebarRowAction}
          hitSlop={6}
          onPress={(event) => {
            event.stopPropagation();
            onMore();
          }}
        >
          <Ionicons name="ellipsis-horizontal" size={19} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function collectionPathName(collection: CardCollection, collections: CardCollection[]): string {
  const names = [collection.name];
  let parentId = collection.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = collections.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}

function SearchResultCard({ result, onPress }: { result: RecallCandidate; onPress: () => void }) {
  const match = result.matches?.[0];
  const fieldLabel = match?.field === "topic"
    ? "相关内容"
    : match?.field === "original"
      ? "原文"
      : "自然表达";
  return (
    <Pressable style={styles.searchResultCard} onPress={onPress}>
      <View style={styles.searchResultHeader}>
        <Text numberOfLines={2} style={styles.searchResultPrimary}>{result.originalText}</Text>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
      </View>
      {match ? (
        <View style={styles.matchMeta}>
          <Text style={styles.matchField}>{fieldLabel}</Text>
          {match.matchType === "variant" ? <Text style={styles.matchVariant}>词形匹配 · {match.surfaceText}</Text> : null}
        </View>
      ) : null}
      <Text numberOfLines={3} style={styles.matchSentence}>
        {match?.sentence || result.rewrittenText || result.originalText}
      </Text>
      <Text numberOfLines={1} style={styles.searchResultOriginal}>{result.originalText}</Text>
    </Pressable>
  );
}

function CollectionMoveModal({ visible, collections, collectionId, onClose, onMove }: {
  visible: boolean;
  collections: CardCollection[];
  collectionId: string | null;
  onClose: () => void;
  onMove: (collectionId: string, parentId: string | null) => Promise<void>;
}) {
  const [movingTo, setMovingTo] = useState<string | null | undefined>(undefined);
  const moving = collections.find((collection) => collection.id === collectionId) ?? null;
  const move = async (parentId: string | null) => {
    if (!moving || movingTo !== undefined || moving.parentId === parentId) {
      if (moving?.parentId === parentId) onClose();
      return;
    }
    setMovingTo(parentId);
    try {
      await onMove(moving.id, parentId);
      onClose();
    } catch (error) {
      Alert.alert("无法移动生活集", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setMovingTo(undefined);
    }
  };
  const unavailableIds = moving ? collectionDescendantIds(moving.id, collections) : new Set<string>();
  if (moving) unavailableIds.add(moving.id);
  const moveTargets = collectionTreeRows(collections).filter(({ collection }) => !unavailableIds.has(collection.id));
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalPage}>
        <View style={styles.modalHeader}>
          <Pressable style={styles.modalHeaderButton} onPress={onClose}><Text style={styles.modalCancel}>取消</Text></Pressable>
          <Text style={styles.modalTitle}>{moving ? `移动“${moving.name}”` : "移动到"}</Text>
          <View style={styles.modalHeaderButton} />
        </View>
        <ScrollView contentContainerStyle={styles.collectionManagerList}>
          {moving ? (
            <>
              <Text style={styles.collectionMoveHint}>选择新的所属生活集</Text>
              <Pressable style={styles.collectionMoveRow} onPress={() => void move(null)}>
                <Ionicons name="albums-outline" size={20} color={theme.colors.textSecondary} />
                <Text style={styles.collectionRowName}>生活集顶层</Text>
                {moving.parentId === null ? <Ionicons name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
                {movingTo === null ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : null}
              </Pressable>
              {moveTargets.map(({ collection, depth }) => (
                <Pressable key={collection.id} style={[styles.collectionMoveRow, { paddingLeft: 12 + depth * 20 }]} onPress={() => void move(collection.id)}>
                  <Ionicons name="folder-outline" size={20} color={theme.colors.textSecondary} />
                  <Text style={styles.collectionRowName}>{collection.name}</Text>
                  {moving.parentId === collection.id ? <Ionicons name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
                  {movingTo === collection.id ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : null}
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function collectionTreeRows(collections: CardCollection[]): Array<{ collection: CardCollection; depth: number }> {
  const rows: Array<{ collection: CardCollection; depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    collections
      .filter((collection) => collection.parentId === parentId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
      .forEach((collection) => {
        rows.push({ collection, depth });
        visit(collection.id, depth + 1);
      });
  };
  visit(null, 0);
  return rows;
}

function collectionDescendantIds(collectionId: string, collections: CardCollection[]): Set<string> {
  const descendants = new Set<string>();
  const visit = (parentId: string) => {
    collections.filter((collection) => collection.parentId === parentId).forEach((collection) => {
      if (descendants.has(collection.id)) return;
      descendants.add(collection.id);
      visit(collection.id);
    });
  };
  visit(collectionId);
  return descendants;
}

function CardCard({ record, compact = false, onPress, onDelete }: {
  record: CardRecordSummary;
  compact?: boolean;
  onPress: () => void;
  onDelete: () => void;
}) {
  const processing = record.status !== "completed";
  return (
    <Pressable style={[styles.card, compact && styles.cardCompact]} onPress={onPress}>
      <View style={styles.cardContent}>
        <View style={styles.cardTextColumn}>
          {processing ? (
            <>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.originalText}>{record.originalPreview}</Text>
              <Text style={styles.processingText}>正在整理这段记录…</Text>
            </>
          ) : (
            <>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.rewrittenText}>{record.rewrittenPreview}</Text>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.originalText}>{record.originalPreview}</Text>
            </>
          )}
        </View>
        {record.thumbnail ? <Image source={{ uri: record.thumbnail.url }} resizeMode="cover" style={styles.thumbnail} /> : null}
      </View>
      <View style={styles.cardFooter}>
        <Text numberOfLines={1} style={styles.cardTime}>{formatCardDateLabel(record.dateKey)} · {formatTime(record.createdAt)}</Text>
        {record.isSample ? <Text style={styles.sampleBadge}>示例</Text> : null}
        {processing ? <ActivityIndicator size="small" color={theme.colors.accent} /> : (
          <Pressable accessibilityLabel="记录操作" style={styles.cardMoreButton} hitSlop={8} onPress={(event) => { event.stopPropagation(); onDelete(); }}>
            <Ionicons name="ellipsis-horizontal" size={19} color={theme.colors.textMuted} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

function countGraphemes(value: string): number {
  const Segmenter = (Intl as unknown as { Segmenter?: new (...args: unknown[]) => { segment: (text: string) => Iterable<unknown> } }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(value)).length : Array.from(value).length;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = toDateKey(new Date());
  if (dateKey === today) return `今天 · ${month}月${day}日`;
  return `${year}年${month}月${day}日 · ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]}`;
}

function formatCardDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const now = new Date();
  if (dateKey === toDateKey(now)) return "今天";
  if (year === now.getFullYear()) return `${month}月${day}日`;
  return `${year}.${month}.${day}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const editorialFont = Platform.select({ ios: "STSongti-SC-Regular", android: "serif", default: "serif" });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.canvas },
  brandRow: { minHeight: 52, paddingHorizontal: 16, paddingTop: 3, flexDirection: "row", alignItems: "center" },
  brand: { flex: 1, marginLeft: 10, color: theme.colors.text, fontSize: 20, lineHeight: 27, fontWeight: "500", letterSpacing: -0.2 },
  headerDate: { color: theme.colors.textMuted, fontSize: 13 },
  headerActions: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 2 },
  recordButton: { minHeight: 44, paddingHorizontal: 13, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentStrong, flexDirection: "row", alignItems: "center", gap: 5 },
  recordButtonText: { color: theme.colors.surface, fontSize: 13, fontWeight: "600" },
  headerIconButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  librarySection: { minHeight: 44, marginBottom: 20, paddingLeft: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, flexDirection: "row", alignItems: "flex-start" },
  collectionScroller: { flex: 1 },
  collectionTabs: { paddingRight: 20, gap: 26 },
  collectionChip: { maxWidth: 180, minHeight: 36, paddingTop: 2, paddingBottom: 9, borderBottomWidth: 2, borderBottomColor: "transparent", alignItems: "center", justifyContent: "center" },
  collectionChipSelected: { borderBottomColor: theme.colors.text },
  collectionChipText: { color: theme.colors.textMuted, fontSize: 14, letterSpacing: 0.15 },
  collectionChipTextSelected: { color: theme.colors.text, fontWeight: "500" },
  searchRow: { marginHorizontal: 20, marginBottom: 18, minHeight: 46, paddingLeft: 13, paddingRight: 4, borderRadius: 12, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, minHeight: 44, color: theme.colors.text, fontSize: 14 },
  searchSubmit: { minWidth: 58, height: 38, paddingHorizontal: 11, borderRadius: 10, backgroundColor: theme.colors.accentStrong, alignItems: "center", justifyContent: "center" },
  searchSubmitText: { color: theme.colors.surface, fontSize: 13, fontWeight: "600" },
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 96 },
  loader: { marginVertical: 32 },
  loadMoreIndicator: { marginVertical: 20 },
  searchSummary: { marginBottom: 10, color: theme.colors.textMuted, fontSize: 12 },
  searchResultCard: { marginBottom: 10, padding: 15, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  searchResultHeader: { flexDirection: "row", alignItems: "center" },
  searchResultPrimary: { flex: 1, color: theme.colors.text, fontFamily: editorialFont, fontSize: 16, lineHeight: 24 },
  matchMeta: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  matchField: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: theme.radius.pill, overflow: "hidden", backgroundColor: theme.colors.accentSoft, color: theme.colors.accentStrong, fontSize: 10, fontWeight: "600" },
  matchVariant: { color: theme.colors.textMuted, fontSize: 11 },
  matchSentence: { marginTop: 8, color: theme.colors.text, fontSize: 15, lineHeight: 22 },
  searchResultOriginal: { marginTop: 9, color: theme.colors.textMuted, fontSize: 12 },
  emptyCard: { marginTop: 14, paddingVertical: 52, paddingHorizontal: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, alignItems: "center" },
  emptyTitle: { color: theme.colors.text, textAlign: "center", fontSize: 18, lineHeight: 25, fontWeight: "500" },
  emptyText: { maxWidth: 280, marginTop: 9, color: theme.colors.textMuted, textAlign: "center", fontSize: 14, lineHeight: 21 },
  emptyAction: { marginTop: 22, minHeight: 46, paddingHorizontal: 18, borderRadius: 10, backgroundColor: theme.colors.accentStrong, alignItems: "center", justifyContent: "center" },
  emptyActionText: { color: theme.colors.surface, fontSize: 14, fontWeight: "600" },
  card: { paddingTop: 13, paddingBottom: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  cardCompact: { opacity: 0.92 },
  cardFooter: { marginTop: 7, minHeight: 22, flexDirection: "row", alignItems: "center" },
  cardTime: { flex: 1, color: theme.colors.textMuted, fontSize: 11, lineHeight: 17, fontWeight: "400", letterSpacing: 0.1 },
  cardMoreButton: { width: 32, height: 24, alignItems: "flex-end", justifyContent: "center" },
  sampleBadge: { marginRight: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSoft, color: theme.colors.accentStrong, fontSize: 10 },
  cardContent: { minHeight: 54, flexDirection: "row", alignItems: "flex-start", gap: 14 },
  cardTextColumn: { flex: 1, minWidth: 0, paddingTop: 2 },
  thumbnail: { width: 88, height: 72, borderRadius: 8, backgroundColor: theme.colors.surfaceMuted },
  originalText: { marginTop: 4, color: theme.colors.textMuted, fontSize: 12, lineHeight: 17, fontWeight: "400", letterSpacing: 0.05 },
  divider: { marginVertical: 10, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
  rewrittenText: { color: theme.colors.text, fontFamily: editorialFont, fontSize: 16, lineHeight: 22, fontWeight: "400" },
  cardDate: { marginTop: 9, color: theme.colors.textMuted, fontSize: 11 },
  processingText: { marginTop: 5, color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  floatingRecordButton: { position: "absolute", right: 20, bottom: 20, width: 54, height: 54, borderRadius: 27, backgroundColor: "#F2DFC3", alignItems: "center", justifyContent: "center", shadowColor: "#51483D", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  modalPage: { flex: 1, backgroundColor: theme.colors.canvas },
  modalHeader: { minHeight: 58, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  modalHeaderButton: { width: 62, minHeight: 44, alignItems: "center", justifyContent: "center" },
  modalTitle: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 16, fontWeight: "500" },
  modalTitleSpacer: { flex: 1 },
  modalCancel: { color: theme.colors.textSecondary, fontSize: 15 },
  modalSend: { color: theme.colors.accentStrong, fontSize: 15, fontWeight: "600" },
  collectionEditor: { padding: 16, flexDirection: "row", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  collectionManagerList: { padding: 16, paddingBottom: 40 },
  collectionMoveHint: { paddingHorizontal: 12, paddingTop: 5, paddingBottom: 12, color: theme.colors.textMuted, fontSize: 13 },
  collectionMoveRow: { minHeight: 54, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  collectionRowName: { flex: 1, color: theme.colors.text, fontSize: 15 },
  sidebarOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 20 },
  sidebarAnimatedContent: { position: "absolute", top: 0, bottom: 0, left: 0, width: "84%", maxWidth: 360, zIndex: 2 },
  sidebarAnimatedScrim: { ...StyleSheet.absoluteFillObject, zIndex: 1, backgroundColor: "rgba(28, 29, 27, 0.18)" },
  sidebar: { flex: 1, width: "100%", backgroundColor: theme.colors.canvas, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 8, height: 0 }, elevation: 12 },
  sidebarHeader: { minHeight: 66, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sidebarBrand: { color: theme.colors.text, fontSize: 27, fontWeight: "800", letterSpacing: -1.4 },
  sidebarFixedContent: { paddingHorizontal: 14 },
  sidebarCollectionSection: { flex: 1, minHeight: 0, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  sidebarCollectionScroller: { flex: 1 },
  sidebarCollectionContent: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 24 },
  sidebarRow: { minHeight: 54, paddingHorizontal: 14, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 14 },
  sidebarDisclosure: { width: 16, height: 32, marginRight: -8, alignItems: "center", justifyContent: "center" },
  sidebarRowSelected: { backgroundColor: "#EEEAE3" },
  sidebarRowLabel: { flex: 1, minWidth: 0, color: theme.colors.text, fontSize: 16, lineHeight: 22, fontWeight: "400" },
  sidebarRowLabelSelected: { color: theme.colors.text },
  sidebarRowCount: { minWidth: 24, color: theme.colors.textMuted, fontSize: 13, textAlign: "right" },
  sidebarRowAction: { width: 28, height: 34, marginHorizontal: -5, alignItems: "center", justifyContent: "center" },
  sidebarDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12, marginVertical: 15, backgroundColor: theme.colors.border },
  sidebarSectionHeader: { minHeight: 42, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sidebarLifeSectionHeader: { marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  sidebarSectionToggle: { minHeight: 42, flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  sidebarSectionTitle: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "400", letterSpacing: 0.3 },
  sidebarSectionActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  sidebarSectionAction: { width: 34, height: 36, alignItems: "center", justifyContent: "center" },
  sidebarCreateRow: { minHeight: 48, marginHorizontal: 6, marginBottom: 4, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, flexDirection: "row", alignItems: "center", gap: 10 },
  sidebarCreateInput: { flex: 1, minHeight: 44, paddingVertical: 0, color: theme.colors.text, fontSize: 15 },
  sidebarEmpty: { paddingHorizontal: 14, paddingVertical: 12, color: theme.colors.textMuted, fontSize: 13, lineHeight: 20 },
});
