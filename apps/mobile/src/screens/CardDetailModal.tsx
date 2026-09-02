import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  type GestureResponderEvent,
  Image,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import * as MediaLibrary from "expo-media-library";
import { File, Paths } from "expo-file-system";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView, KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Svg, { Defs, Mask, Path, Rect } from "react-native-svg";
import { playIncorrectFeedbackSound, playSuccessFeedbackSound } from "../services/audio/gameFeedbackAudio";
import {
  saveCardClozeUpdate,
  getCardArticleAudio,
  getCardRecord,
  getCardSegmentAudio,
  getCardRelations,
  getCardCollections,
  getCardCapabilities,
  DEFAULT_CARD_CAPABILITIES,
  type CardClozeState,
  type CardRelationReason,
  type CardRelationPreview,
  type CardRecordDetail,
  type CardLearningContentType,
  type CardCollection,
  type CardCapabilities,
  CardApiError,
  deleteCardRecord,
} from "../services/api/cardApi";
import type { CardDraft } from "../services/card/cardDraftStorage";
import { theme } from "../theme";
import { TtsMiniPlayer } from "../components/TtsMiniPlayer";
import { RealtimeSttButton } from "../components/RealtimeSttButton";
import { beginTtsPlaybackSession, getTtsPlaybackState, isTtsPlaybackSessionCurrent, playTtsAudio, preloadTtsAudio, setTtsNavigationControls, stopTtsAudio, subscribeTtsPlayback, toggleTtsPlayback } from "../services/tts/ttsPlayback";
import {
  SelectableMessageText,
  type NativeTextSelectionPayload,
} from "./chat/SelectableMessageText";
import { DictionaryPopover } from "./chat/DictionaryPopover";
import { dictionaryLookupErrorKey, lookupDictionary, type DictionaryLookupResult } from "../services/api/dictionaryApi";
import { getLanguage, t, tf } from "../i18n";
import { expandSelectionToCardBlankRange, getCardClozeActualUnitMatches, splitCardClozeAnswerUnits } from "../domain/cloze/clozeUtils";
import { useRealtimeSttInput, type RealtimeSttInputStatus } from "../hooks/useRealtimeSttInput";
import { CollectionPickerModal, collectionPathName } from "./shared/CollectionPickerModal";
import { hasLocalStrictProAccess } from "../services/entitlement/proAccess";
import { copyTextToClipboard } from "../services/device/clipboardService";
import { useFloatingNotice } from "./shared/FloatingNotice";
import type { CardGenerationTarget } from "../services/card/cardContentGeneration";
import { completeClozeOnboarding, shouldShowClozeOnboarding } from "../services/card/clozeOnboarding";

type DetailTab = "review" | "cloze" | "dictation";
type ClozeInputMode = "keyboard" | "choice";
type ClozeInteractionMode = "edit" | ClozeInputMode;
type PendingClozeCheckHandler = () => Promise<void>;

function initialClozeInteractionMode(autoStart: boolean, blankCount: number): ClozeInteractionMode {
  if (!autoStart || blankCount === 0) return "edit";
  return blankCount === 1 ? "keyboard" : "choice";
}
type ClozeChoiceOption = { value: string; incorrect: boolean };
type CardBlankActionAnchor = { pageX: number; pageY: number; width: number; height: number };
type CardContentBinding = { contentType: CardLearningContentType; contentVersion: string };
type ClozeOnboardingTarget = { x: number; y: number; width: number; height: number };
export function CardDetailModal({ detail, loading, imageAdding = false, transitionOrigin, draft, draftSafeArea, draftLimits, draftCollections = [], initialTab = "review", initialEditing = false, closeAfterEditing = false, onClose, returnLabel, onReplaceImage, onRemoveImage, onCoverPositionChange, onDraftChange, onDraftFieldChange, onDraftEnabledLayersChange, onDraftCollectionChange, onDraftCreateCollection, onDraftRenameCollection, onDraftDeleteCollection, onDraftSave, onDraftChooseImage, onDraftTakePhoto, onDraftSelectImage, onDraftRemoveImage, onDraftCoverPositionChange, canGoBack = false, canGoForward = false, onBack, onForward, onOpenRelated, hideRelations = false, onUpdateContent, onEditCard, pendingGenerationTargets = [], failedGenerationTargets = [], retryingGenerationTarget = null, onRetryGeneration, recallPosition, recallPreviousDetail, recallNextDetail, onRecallPrevious, onRecallNext, onRecallFinish, onClozeAttempt, onClozeStateChange }: {
  detail: CardRecordDetail | null;
  loading: boolean;
  imageAdding?: boolean;
  transitionOrigin?: { x: number; y: number; width: number; height: number };
  draft?: {
    value: CardDraft;
    sending: boolean;
    imageAdding?: boolean;
  };
  draftSafeArea?: { top: number; bottom: number };
  draftLimits?: CardCapabilities["limits"];
  draftCollections?: CardCollection[];
  initialTab?: DetailTab;
  initialEditing?: boolean;
  closeAfterEditing?: boolean;
  onClose: () => void;
  returnLabel?: string;
  onReplaceImage?: (source: "camera" | "library", asset?: { uri: string; width: number; height: number }) => Promise<void> | void;
  onRemoveImage?: (imageId?: string) => void;
  onCoverPositionChange?: (imageId: string, focusX: number, focusY: number) => Promise<void>;
  onDraftChange?: (text: string) => void;
  onDraftFieldChange?: (field: "title" | "rewrittenText" | "translationText" | "replyText", value: string) => void;
  onDraftEnabledLayersChange?: (layers: CardDraft["enabledLayers"]) => void;
  onDraftCollectionChange?: (collectionId: string | null) => void;
  onDraftCreateCollection?: (name: string, parentId: string | null) => Promise<CardCollection>;
  onDraftRenameCollection?: (collectionId: string, name: string) => Promise<void>;
  onDraftDeleteCollection?: (collection: CardCollection) => Promise<void>;
  onDraftSave?: (initialTab?: DetailTab) => void;
  onDraftChooseImage?: () => void;
  onDraftTakePhoto?: () => void;
  onDraftSelectImage?: (asset: { uri: string; width: number; height: number }) => Promise<void> | void;
  onDraftRemoveImage?: (localUri?: string) => void;
  onDraftCoverPositionChange?: (localUri: string, focusX: number, focusY: number) => Promise<void> | void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  onOpenRelated?: (recordId: string, reasons: CardRelationReason[]) => void;
  hideRelations?: boolean;
  onUpdateContent?: (input: { title: string | null; originalText: string; collectionId: string | null; selectedTargets: Array<"expression" | "translation" | "reply"> }) => Promise<boolean | void>;
  onEditCard?: () => void;
  pendingGenerationTargets?: CardGenerationTarget[];
  failedGenerationTargets?: CardGenerationTarget[];
  retryingGenerationTarget?: CardGenerationTarget | null;
  onRetryGeneration?: (target: CardGenerationTarget) => void;
  recallPosition?: { index: number; total: number };
  recallPreviousDetail?: CardRecordDetail | null;
  recallNextDetail?: CardRecordDetail | null;
  onRecallPrevious?: () => void;
  onRecallNext?: () => void;
  onRecallFinish?: () => void;
  onClozeAttempt?: (input: { recordId: string; blankId: string; correct: boolean }) => void;
  onClozeStateChange?: (input: { recordId: string; contentType: CardLearningContentType; contentVersion: string; state: CardClozeState; version: number }) => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const mountedWithDetailRef = useRef(Boolean(detail));
  const exitProgress = useRef(new Animated.Value(detail || transitionOrigin ? 1 : 0)).current;
  const exitingRef = useRef(false);
  const pendingClozeCheckRef = useRef<PendingClozeCheckHandler | null>(null);
  const checkingClozeBeforeExitRef = useRef(false);
  const enteredRef = useRef(false);
  const recallTranslateX = useRef(new Animated.Value(0)).current;
  const recallNavigatingRef = useRef(false);
  const [recallInteractionLocked, setRecallInteractionLocked] = useState(false);
  const [tab, setTab] = useState<DetailTab>(initialTab === "cloze" ? "review" : initialTab);
  const clozeEntryModeRef = useRef<{ recordId: string | null; autoStart: boolean }>({
    recordId: detail?.id ?? null,
    autoStart: initialTab === "cloze",
  });
  if ((detail?.id ?? null) !== clozeEntryModeRef.current.recordId) {
    clozeEntryModeRef.current = { recordId: detail?.id ?? null, autoStart: initialTab === "cloze" };
  }
  const [editing, setEditing] = useState(initialEditing);
  const [detailActionMenuVisible, setDetailActionMenuVisible] = useState(false);
  const practiceMode = tab === "dictation";
  const [clozeState, setClozeState] = useState<CardClozeState>({ schemaVersion: 1, blanks: [] });
  const [clozeVersion, setClozeVersion] = useState(0);
  const [clozeOwnerKey, setClozeOwnerKey] = useState<string | null>(null);
  const clozeStateCacheRef = useRef(new Map<string, { state: CardClozeState; version: number }>());
  const [hasProAccess, setHasProAccess] = useState<boolean | null>(null);
  const [clozeTipVisible, setClozeTipVisible] = useState(false);
  const [clozeTipEligible, setClozeTipEligible] = useState(false);
  const [clozeTipTarget, setClozeTipTarget] = useState<ClozeOnboardingTarget | null>(null);
  const [clozeGuideStep, setClozeGuideStep] = useState<1 | 2>(1);
  const handleClozeLearningTargetReady = useCallback((target: ClozeOnboardingTarget) => {
    setClozeTipTarget(target);
    setClozeTipVisible(true);
  }, []);
  const handleClozeActionBarTargetReady = useCallback((target: ClozeOnboardingTarget) => {
    setClozeTipTarget(target);
    setClozeTipVisible(true);
  }, []);
  const [recallHandoff, setRecallHandoff] = useState<{
    direction: "next" | "previous";
    detail: CardRecordDetail;
    position: { index: number; total: number };
  } | null>(null);
  const recallPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) => Boolean(
      recallPosition
      && !recallInteractionLocked
      && Math.abs(gesture.dx) > 24
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    ),
    onPanResponderMove: (_, gesture) => {
      if (recallNavigatingRef.current) return;
      const atUnavailableEdge = gesture.dx > 0 ? !recallPreviousDetail : !recallNextDetail;
      recallTranslateX.setValue(gesture.dx * (atUnavailableEdge ? 0.16 : 0.72));
    },
    onPanResponderRelease: (_, gesture) => {
      const direction = gesture.dx < 0 ? "next" : "previous";
      const action = direction === "next" ? onRecallNext : onRecallPrevious;
      if (Math.abs(gesture.dx) < 72 || !action) {
        Animated.spring(recallTranslateX, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 4 }).start();
        return;
      }
      recallNavigatingRef.current = true;
      const handoffDetail = direction === "next" ? recallNextDetail : recallPreviousDetail;
      if (handoffDetail && recallPosition) setRecallHandoff({
        direction,
        detail: handoffDetail,
        position: {
          index: recallPosition.index + (direction === "next" ? 1 : -1),
          total: recallPosition.total,
        },
      });
      Animated.timing(recallTranslateX, {
        toValue: direction === "next" ? -windowWidth : windowWidth,
        duration: 170,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        Keyboard.dismiss();
        action();
        requestAnimationFrame(() => {
          recallTranslateX.setValue(0);
          setRecallHandoff(null);
          requestAnimationFrame(() => { recallNavigatingRef.current = false; });
        });
      });
    },
    onPanResponderTerminate: () => {
      Animated.spring(recallTranslateX, { toValue: 0, useNativeDriver: true }).start();
    },
  }), [onRecallNext, onRecallPrevious, recallInteractionLocked, recallNextDetail, recallPosition, recallPreviousDetail, recallTranslateX, windowWidth]);
  const contentBlocks = useMemo(() => detail ? learningContentBlocks(detail) : [], [detail]);
  const activeBlock = contentBlocks.find((block) => block.contentType === "rewrite")
    ?? contentBlocks.find((block) => block.contentType === "original")
    ?? contentBlocks[0]
    ?? null;
  const contentBinding = activeBlock ? { contentType: activeBlock.contentType, contentVersion: activeBlock.contentVersion } : null;
  const activeClozeOwnerKey = detail && activeBlock ? `${detail.id}:${activeBlock.contentType}:${activeBlock.contentVersion}` : null;
  const cachedActiveCloze = activeClozeOwnerKey ? clozeStateCacheRef.current.get(activeClozeOwnerKey) : undefined;
  const resolvedClozeState = activeClozeOwnerKey && clozeOwnerKey === activeClozeOwnerKey
    ? clozeState
    : cachedActiveCloze?.state ?? asCardClozeState(activeBlock?.practice?.clozeState);
  const resolvedClozeVersion = activeClozeOwnerKey && clozeOwnerKey === activeClozeOwnerKey
    ? clozeVersion
    : cachedActiveCloze?.version ?? activeBlock?.practice?.clozeVersion ?? 0;
  const canPracticeActiveBlock = activeBlock?.contentType !== "original" || hasProAccess === true;
  const practiceDetail = detail && activeBlock ? {
    ...detail,
    languageCode: activeBlock.languageCode,
    rewriteSegments: activeBlock.segments,
    practice: activeBlock.practice,
  } : detail;
  useEffect(() => () => stopTtsAudio({ resetControls: true }), []);
  useEffect(() => {
    if (recallPosition) stopTtsAudio({ resetControls: true });
  }, [detail?.id]);
  useEffect(() => {
    let active = true;
    void hasLocalStrictProAccess()
      .then((value) => { if (active) setHasProAccess(value); })
      .catch(() => { if (active) setHasProAccess(false); });
    return () => { active = false; };
  }, [detail?.id]);
  useEffect(() => {
    if (hasProAccess === false && tab === "dictation") setTab("review");
  }, [hasProAccess, tab]);
  useEffect(() => {
    if (
      !detail
      || activeBlock?.contentType !== "rewrite"
      || pendingGenerationTargets.length > 0
      || failedGenerationTargets.length > 0
    ) return;
    let active = true;
    void shouldShowClozeOnboarding(detail.id)
      .then((shouldShow) => { if (active && shouldShow) setClozeTipEligible(true); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [activeBlock?.contentType, detail?.id, failedGenerationTargets, pendingGenerationTargets]);
  useEffect(() => {
    if (!detail || enteredRef.current) return;
    enteredRef.current = true;
    if (!mountedWithDetailRef.current && !transitionOrigin) {
      exitProgress.setValue(0);
      return;
    }
    exitProgress.setValue(1);
    const frame = requestAnimationFrame(() => {
      Animated.timing(exitProgress, {
        toValue: 0,
        duration: transitionOrigin ? 250 : 230,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    return () => {
      cancelAnimationFrame(frame);
      exitProgress.stopAnimation();
    };
  }, [detail?.id, transitionOrigin?.x, transitionOrigin?.y, transitionOrigin?.width, transitionOrigin?.height]);
  useEffect(() => {
    if (detail) {
      setEditing(initialEditing);
      setTab(initialTab === "cloze" ? "review" : initialTab);
    }
  }, [detail?.id, initialEditing, initialTab]);
  useEffect(() => {
    if (!detail || !activeClozeOwnerKey) return;
    const incoming = {
      state: asCardClozeState(activeBlock?.practice?.clozeState),
      version: activeBlock?.practice?.clozeVersion ?? 0,
    };
    const cached = clozeStateCacheRef.current.get(activeClozeOwnerKey);
    const next = cached && cached.version >= incoming.version ? cached : incoming;
    clozeStateCacheRef.current.set(activeClozeOwnerKey, next);
    setClozeState(next.state);
    setClozeVersion(next.version);
    setClozeOwnerKey(activeClozeOwnerKey);
  }, [
    detail?.id,
    activeBlock?.contentType,
    activeBlock?.contentVersion,
    activeBlock?.practice?.clozeVersion,
    activeClozeOwnerKey,
  ]);
  const updateCloze = (state: CardClozeState, version: number) => {
    if (activeClozeOwnerKey) clozeStateCacheRef.current.set(activeClozeOwnerKey, { state, version });
    if (detail && activeBlock) onClozeStateChange?.({
      recordId: detail.id,
      contentType: activeBlock.contentType,
      contentVersion: activeBlock.contentVersion,
      state,
      version,
    });
    setClozeState(state);
    setClozeVersion(version);
    setClozeOwnerKey(activeClozeOwnerKey);
  };
  function animateExit(action: () => void, staysMounted: boolean): void {
    if (exitingRef.current) return;
    exitingRef.current = true;
    Animated.timing(exitProgress, {
      toValue: 1,
      duration: transitionOrigin ? 230 : 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        exitingRef.current = false;
        return;
      }
      exitingRef.current = false;
      action();
      if (staysMounted) {
        Animated.timing(exitProgress, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }).start();
      }
    });
  }
  const registerPendingClozeCheck = useCallback((handler: PendingClozeCheckHandler | null) => {
    pendingClozeCheckRef.current = handler;
  }, []);
  function leaveCard(action: () => void, animated: boolean): void {
    if (checkingClozeBeforeExitRef.current || exitingRef.current) return;
    checkingClozeBeforeExitRef.current = true;
    Keyboard.dismiss();
    void Promise.resolve(pendingClozeCheckRef.current?.())
      .catch(() => undefined)
      .finally(() => {
        checkingClozeBeforeExitRef.current = false;
        if (animated) animateExit(action, false);
        else action();
      });
  }
  const [relations, setRelations] = useState<Array<{ recordId: string; topic: string | null; card: CardRelationPreview | null; reasons: CardRelationReason[] }>>([]);
  const [cardCapabilities, setCardCapabilities] = useState<CardCapabilities>(DEFAULT_CARD_CAPABILITIES);
  const cardLimits = draftLimits ?? cardCapabilities.limits;
  useEffect(() => {
    let active = true;
    void getCardCapabilities()
      .then((value) => { if (active) setCardCapabilities(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!detail || hideRelations) {
      setRelations([]);
      return;
    }
    let cancelled = false;
    const request = getCardRelations(detail.id, 50);
    void request.then((items) => { if (!cancelled) setRelations(items); })
      .catch(() => { if (!cancelled) setRelations([]); });
    return () => { cancelled = true; };
  }, [detail?.id, hideRelations]);
  if (draft) {
    return (
      <DraftCard
        draft={draft.value}
        sending={draft.sending}
        imageAdding={draft.imageAdding === true}
        safeArea={draftSafeArea}
        limits={cardLimits}
        collections={draftCollections}
        onClose={onClose}
        onChangeText={onDraftChange}
        onChangeField={onDraftFieldChange}
        onEnabledLayersChange={onDraftEnabledLayersChange}
        onCollectionChange={onDraftCollectionChange}
        onCreateCollection={onDraftCreateCollection}
        onRenameCollection={onDraftRenameCollection}
        onDeleteCollection={onDraftDeleteCollection}
        onSave={onDraftSave}
        onChooseImage={onDraftChooseImage}
        onTakePhoto={onDraftTakePhoto}
        onSelectImage={onDraftSelectImage}
        onRemoveImage={onDraftRemoveImage}
        onCoverPositionChange={onDraftCoverPositionChange}
      />
    );
  }
  if (detail && editing) {
    return <ExistingCardEditor
      detail={detail}
      limits={cardLimits}
      imageAdding={imageAdding}
      onAddImage={onReplaceImage}
      onRemoveImage={onRemoveImage}
      onCoverPositionChange={onCoverPositionChange}
      onCancel={() => closeAfterEditing ? onClose() : setEditing(false)}
      onSave={async (input) => {
        const accepted = await onUpdateContent?.(input);
        if (accepted === false) return;
        if (closeAfterEditing) onClose();
        else setEditing(false);
      }}
    />;
  }
  if (!detail && !loading) return null;
  return (
    <Animated.View style={[
      styles.fullscreen,
      {
        opacity: exitProgress.interpolate({ inputRange: [0, 0.68, 0.92, 1], outputRange: [1, 1, 0.18, 0] }),
        transform: [
          { translateX: exitProgress.interpolate({ inputRange: [0, 1], outputRange: [0, transitionOrigin ? transitionOrigin.x + transitionOrigin.width / 2 - windowWidth / 2 : windowWidth * 0.12] }) },
          { translateY: exitProgress.interpolate({ inputRange: [0, 1], outputRange: [0, transitionOrigin ? transitionOrigin.y + transitionOrigin.height / 2 - windowHeight / 2 : 0] }) },
          { scale: exitProgress.interpolate({ inputRange: [0, 1], outputRange: [1, transitionOrigin ? Math.max(0.1, transitionOrigin.width / windowWidth) : 1] }) },
        ],
      },
    ]}>
      <Animated.View style={[styles.recallDetailPage, recallPosition && { transform: [{ translateX: recallTranslateX }] }]} {...(recallPosition ? recallPanResponder.panHandlers : {})}>
      {recallPosition && (recallHandoff?.direction === "previous" ? recallHandoff.detail : recallPreviousDetail) ? <View pointerEvents="none" style={[styles.recallAdjacentPage, { left: -windowWidth }]}><RecallAdjacentCard detail={(recallHandoff?.direction === "previous" ? recallHandoff.detail : recallPreviousDetail)!} position={recallHandoff?.direction === "previous" ? recallHandoff.position : { index: recallPosition.index - 1, total: recallPosition.total }} canUseDictation={hasProAccess === true} /></View> : null}
      <SafeAreaView style={styles.page}>
        <View style={styles.header}>
          <View style={styles.historyButtons}>
            <Pressable accessibilityLabel={returnLabel ?? (recallPosition && tab === "review" ? t("recall.exit") : tab === "dictation" || canGoBack && onBack ? t("card_detail.a11y.back") : t("card_detail.a11y.close"))} style={styles.historyButton} onPress={recallPosition && tab === "review" ? () => leaveCard(onClose, false) : tab === "dictation" ? () => setTab("review") : canGoBack && onBack ? () => leaveCard(onBack, false) : () => leaveCard(onClose, true)}><Ionicons name="chevron-back" size={22} color={theme.colors.text} /></Pressable>
            {practiceMode && canGoForward && onForward ? <Pressable accessibilityLabel={t("card_detail.a11y.forward")} style={styles.historyButton} onPress={onForward}><Ionicons name="chevron-forward" size={22} color={theme.colors.text} /></Pressable> : null}
          </View>
          <Text numberOfLines={1} style={styles.title}>{practiceMode ? t("card_detail.tab.dictation") : recallPosition ? `${recallPosition.index + 1} / ${recallPosition.total}` : ""}</Text>
          <View style={styles.headerEnd}>
            {tab === "review" && (onUpdateContent || onEditCard) ? <Pressable accessibilityLabel="卡片操作" style={styles.iconHeaderButton} onPress={() => setDetailActionMenuVisible(true)}><Ionicons name="ellipsis-horizontal" size={23} color={theme.colors.text} /></Pressable> : null}
          </View>
        </View>
        {detailActionMenuVisible ? <View style={styles.detailActionLayer}><Pressable style={StyleSheet.absoluteFill} onPress={() => setDetailActionMenuVisible(false)} /><View style={styles.detailActionMenu}><Pressable style={styles.detailActionItem} onPress={() => { setDetailActionMenuVisible(false); (onEditCard ?? (() => setEditing(true)))(); }}><Ionicons name="create-outline" size={17} color={theme.colors.textSecondary} /><Text style={styles.detailActionText}>编辑</Text></Pressable><View style={styles.detailActionDivider} /><Pressable style={styles.detailActionItem} onPress={() => { setDetailActionMenuVisible(false); Alert.alert("移入回收站？", "卡片将在回收站保留 30 天，期间可以随时恢复。", [{ text: t("common.cancel"), style: "cancel" }, { text: "移入回收站", style: "destructive", onPress: () => { if (detail) void deleteCardRecord(detail.id).then(onClose); } }]); }}><Ionicons name="trash-outline" size={17} color={theme.colors.danger} /><Text style={[styles.detailActionText, { color: theme.colors.danger }]}>删除</Text></Pressable></View></View> : null}
        {loading && !detail ? <ActivityIndicator color={theme.colors.accentStrong} style={styles.loader} /> : null}
        {practiceDetail && contentBinding && tab === "review" ? <Review key={practiceDetail.id} detail={practiceDetail} imageAdding={imageAdding} contentBinding={contentBinding} practiceEnabled={canPracticeActiveBlock} canUseDictation={hasProAccess === true} autoStartClozePractice={clozeEntryModeRef.current.autoStart} clozeState={resolvedClozeState} clozeVersion={resolvedClozeVersion} onClozeChange={updateCloze} onRemoveImage={onRemoveImage} onCoverPositionChange={onCoverPositionChange} relations={relations} onOpenRelated={onOpenRelated} onOpenDictation={() => setTab("dictation")} pendingGenerationTargets={pendingGenerationTargets} failedGenerationTargets={failedGenerationTargets} retryingGenerationTarget={retryingGenerationTarget} onRetryGeneration={onRetryGeneration} onRecallFinish={onRecallFinish} onClozeAttempt={onClozeAttempt} onPendingClozeCheckHandlerChange={registerPendingClozeCheck} onInteractionLockChange={recallPosition ? setRecallInteractionLocked : undefined} focusLearningContent={clozeTipEligible && clozeGuideStep === 1} onLearningTargetReady={handleClozeLearningTargetReady} focusActionBar={clozeTipEligible && clozeGuideStep === 2} onActionBarTargetReady={handleClozeActionBarTargetReady} /> : null}
        {practiceDetail && contentBinding && tab === "dictation" && hasProAccess === true ? <Dictation detail={practiceDetail} contentBinding={contentBinding} /> : null}
      </SafeAreaView>
      {recallPosition && (recallHandoff?.direction === "next" ? recallHandoff.detail : recallNextDetail) ? <View pointerEvents="none" style={[styles.recallAdjacentPage, { left: windowWidth }]}><RecallAdjacentCard detail={(recallHandoff?.direction === "next" ? recallHandoff.detail : recallNextDetail)!} position={recallHandoff?.direction === "next" ? recallHandoff.position : { index: recallPosition.index + 1, total: recallPosition.total }} canUseDictation={hasProAccess === true} /></View> : null}
      </Animated.View>
      {clozeTipVisible && clozeTipTarget ? <ClozeOnboardingOverlay
        step={clozeGuideStep}
        target={clozeTipTarget}
        windowWidth={windowWidth}
        windowHeight={windowHeight}
        onAdvance={() => {
          setClozeTipVisible(false);
          setClozeTipTarget(null);
          if (clozeGuideStep === 1) {
            setClozeGuideStep(2);
            return;
          }
          setClozeTipEligible(false);
          if (detail) void completeClozeOnboarding(detail.id);
        }}
      /> : null}
      <TtsMiniPlayer storageKey="linguaflow.tts_mini_player.card.v1" />
    </Animated.View>
  );
}

function ClozeOnboardingOverlay({ step, target, windowWidth, windowHeight, onAdvance }: {
  step: 1 | 2;
  target: ClozeOnboardingTarget;
  windowWidth: number;
  windowHeight: number;
  onAdvance: () => void;
}) {
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(lift, { toValue: 0, speed: 15, bounciness: 5, useNativeDriver: true }),
    ]).start();
  }, [fade, lift]);

  const padding = 11;
  const spotlight = {
    x: Math.max(12, target.x - padding),
    y: Math.max(70, target.y - padding),
    width: Math.min(windowWidth - 24, target.width + padding * 2),
    height: Math.min(target.height + padding * 2, windowHeight - 300),
  };
  const targetX = step === 1
    ? Math.min(spotlight.x + spotlight.width * 0.62, windowWidth - 46)
    : spotlight.x + spotlight.width * 0.54;
  const targetY = step === 1
    ? spotlight.y + Math.min(spotlight.height * 0.62, spotlight.height - 20)
    : spotlight.y + spotlight.height * 0.46;
  const messageTop = step === 1
    ? Math.min(Math.max(spotlight.y + spotlight.height + 88, windowHeight * 0.57), windowHeight - 174)
    : Math.max(102, spotlight.y - 354);
  const arrowStartX = step === 1 ? windowWidth * 0.66 : windowWidth * 0.48;
  const arrowStartY = step === 1 ? messageTop - 16 : spotlight.y - 38;
  const controlX = step === 1
    ? Math.min(windowWidth - 34, Math.max(targetX + 54, arrowStartX + 20))
    : arrowStartX + 34;
  const controlY = step === 1 ? (arrowStartY + targetY) / 2 : arrowStartY + 22;
  const angle = Math.atan2(targetY - controlY, targetX - controlX);
  const arrowSize = 10;
  const arrowLeftX = targetX - arrowSize * Math.cos(angle - Math.PI / 5);
  const arrowLeftY = targetY - arrowSize * Math.sin(angle - Math.PI / 5);
  const arrowRightX = targetX - arrowSize * Math.cos(angle + Math.PI / 5);
  const arrowRightY = targetY - arrowSize * Math.sin(angle + Math.PI / 5);

  return <Animated.View style={[styles.clozeGuideOverlay, { opacity: fade }]}>
    <Pressable accessibilityLabel={step === 1 ? t("card_detail.cloze.onboarding") : t("card_detail.cloze.onboarding_actions_title")} style={StyleSheet.absoluteFillObject} onPress={onAdvance} />
    <Svg pointerEvents="none" width={windowWidth} height={windowHeight} style={StyleSheet.absoluteFillObject}>
      <Defs>
        <Mask id="cloze-guide-mask" x="0" y="0" width={windowWidth} height={windowHeight} maskUnits="userSpaceOnUse">
          <Rect x="0" y="0" width={windowWidth} height={windowHeight} fill="#fff" />
          <Rect x={spotlight.x} y={spotlight.y} width={spotlight.width} height={spotlight.height} rx="18" fill="#000" />
        </Mask>
      </Defs>
      <Rect x="0" y="0" width={windowWidth} height={windowHeight} fill="rgba(15, 16, 20, 0.78)" mask="url(#cloze-guide-mask)" />
      <Rect x={spotlight.x} y={spotlight.y} width={spotlight.width} height={spotlight.height} rx="18" fill="none" stroke="rgba(255,255,255,0.82)" strokeWidth="1.4" />
      <Path d={`M ${arrowStartX} ${arrowStartY} Q ${controlX} ${controlY} ${targetX} ${targetY}`} fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
      <Path d={`M ${arrowLeftX} ${arrowLeftY} L ${targetX} ${targetY} L ${arrowRightX} ${arrowRightY}`} fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
    <Animated.View pointerEvents="box-none" style={[styles.clozeGuideCopy, { top: messageTop, transform: [{ translateY: lift }] }]}>
      <Text style={styles.clozeGuideProgress}>{step} / 2</Text>
      {step === 1
        ? <Text style={styles.clozeGuideText}>{t("card_detail.cloze.onboarding")}</Text>
        : <ClozeActionGuide />}
      <Pressable accessibilityRole="button" accessibilityLabel={step === 1 ? t("common.continue") : t("common.got_it")} style={styles.clozeGuideButtonWrap} onPress={onAdvance}>
        <View style={styles.clozeGuideButtonShadow} />
        <View style={styles.clozeGuideButton}>
          <Text style={styles.clozeGuideButtonText}>{step === 1 ? t("common.continue") : t("common.got_it")}</Text>
          <Ionicons name="arrow-forward" size={17} color="#17171B" />
        </View>
      </Pressable>
    </Animated.View>
  </Animated.View>;
}

function ClozeActionGuide() {
  const actions: Array<{ icon?: React.ComponentProps<typeof Ionicons>["name"]; textIcon?: string; label: string; detail: string }> = [
    { icon: "swap-horizontal-outline", label: t("card_detail.flip"), detail: t("card_detail.cloze.onboarding_action.flip") },
    { icon: "headset-outline", label: t("card_detail.tab.dictation"), detail: t("card_detail.cloze.onboarding_action.dictation") },
    { icon: "eye-outline", label: t("card_detail.dictation.show_answer"), detail: t("card_detail.cloze.onboarding_action.answer") },
    { textIcon: t("card_detail.tab.cloze_short"), label: t("card_detail.cloze.keyboard_mode"), detail: t("card_detail.cloze.onboarding_action.type") },
    { textIcon: t("card_detail.tab.choice_short"), label: t("card_detail.cloze.choice_mode"), detail: t("card_detail.cloze.onboarding_action.choice") },
    { icon: "play", label: t("card_detail.a11y.play_all"), detail: t("card_detail.cloze.onboarding_action.play") },
  ];
  return <View style={styles.clozeActionGuideCard}>
    <Text style={styles.clozeActionGuideTitle}>{t("card_detail.cloze.onboarding_actions_title")}</Text>
    <View style={styles.clozeActionGuideGrid}>
      {actions.map((action) => <View key={action.label} style={styles.clozeActionGuideItem}>
        <View style={styles.clozeActionGuideIcon}>
          {action.icon ? <Ionicons name={action.icon} size={16} color="#FFFFFF" /> : <Text style={styles.clozeActionGuideTextIcon}>{action.textIcon}</Text>}
        </View>
        <View style={styles.clozeActionGuideItemCopy}>
          <Text numberOfLines={1} style={styles.clozeActionGuideLabel}>{action.label}</Text>
          <Text numberOfLines={1} style={styles.clozeActionGuideDetail}>{action.detail}</Text>
        </View>
      </View>)}
    </View>
  </View>;
}

function RecallAdjacentCard({ detail, position, canUseDictation }: { detail: CardRecordDetail; position: { index: number; total: number }; canUseDictation: boolean }) {
  const blocks = learningContentBlocks(detail);
  const learningBlock = blocks.find((block) => block.contentType === "rewrite")
    ?? blocks.find((block) => block.contentType === "original")
    ?? blocks[0];
  if (!learningBlock) return null;
  const previewDetail = { ...detail, languageCode: learningBlock.languageCode, rewriteSegments: learningBlock.segments, practice: learningBlock.practice };
  const previewClozeState = asCardClozeState(learningBlock?.practice?.clozeState);
  const contentBinding = { contentType: learningBlock.contentType, contentVersion: learningBlock.contentVersion };
  const practiceEnabled = learningBlock.contentType !== "original" || canUseDictation;
  return <SafeAreaView style={styles.recallAdjacentSafeArea}>
    <View style={styles.header}><View style={styles.historyButtons}><View style={styles.historyButton} /></View><Text style={styles.title}>{position.index + 1} / {position.total}</Text><View style={styles.headerEnd}><View style={styles.iconHeaderButton}><Ionicons name="close" size={23} color={theme.colors.text} /></View></View></View>
    <Review
      key={`${detail.id}:${contentBinding.contentType}:${contentBinding.contentVersion}`}
      detail={previewDetail}
      imageAdding={false}
      contentBinding={contentBinding}
      practiceEnabled={practiceEnabled}
      canUseDictation={canUseDictation}
      autoStartClozePractice
      clozeState={previewClozeState}
      clozeVersion={learningBlock.practice?.clozeVersion ?? 0}
      onClozeChange={() => undefined}
      relations={[]}
      onOpenDictation={() => undefined}
      onRecallFinish={position.index === position.total - 1 ? () => undefined : undefined}
    />
  </SafeAreaView>;
}

function learningContentBlocks(detail: CardRecordDetail): CardRecordDetail["contentBlocks"] {
  if (detail.contentBlocks?.length) return detail.contentBlocks;
  if (!detail.rewriteSegments.length) return [];
  return [{
    contentType: detail.rewrittenText ? "rewrite" : "original",
    contentVersion: "legacy",
    text: detail.rewrittenText ?? detail.originalText,
    languageCode: detail.languageCode,
    segments: detail.rewriteSegments,
    practice: detail.practice,
  }];
}

function contentPractice(detail: CardRecordDetail, binding: CardContentBinding): CardRecordDetail["practice"] {
  return detail.contentBlocks?.find((block) =>
    block.contentType === binding.contentType && block.contentVersion === binding.contentVersion,
  )?.practice ?? null;
}

function CardEditorHeader({ title, disabled, onClose, hideClose = false }: { title: string; disabled: boolean; onClose: () => void; hideClose?: boolean }) {
  return <View style={styles.header}>
    <View style={styles.draftHeaderSide}>
      {!hideClose ? <Pressable accessibilityLabel={t("card_detail.a11y.close")} style={styles.draftCloseButton} disabled={disabled} onPress={onClose}>
        <Ionicons name="close-outline" size={30} color={theme.colors.text} />
      </Pressable> : null}
    </View>
    <Text style={styles.draftCreateTitle}>{title}</Text>
    <View style={styles.draftHeaderSide} />
  </View>;
}

function ExistingCardEditor({ detail, limits, imageAdding, onAddImage, onRemoveImage, onCoverPositionChange, onCancel, onSave }: {
  detail: CardRecordDetail;
  limits: CardCapabilities["limits"];
  imageAdding: boolean;
  onAddImage?: (source: "camera" | "library", asset?: { uri: string; width: number; height: number }) => Promise<void> | void;
  onRemoveImage?: (imageId?: string) => void;
  onCoverPositionChange?: (imageId: string, focusX: number, focusY: number) => Promise<void>;
  onCancel: () => void;
  onSave: (input: { title: string | null; originalText: string; collectionId: string | null; selectedTargets: Array<"expression" | "translation" | "reply"> }) => Promise<void>;
}) {
  const { showNotice } = useFloatingNotice();
  const [title, setTitle] = useState(detail.title ?? "");
  const [originalText, setOriginalText] = useState(detail.originalText);
  const rewrittenText = detail.rewrittenText ?? "";
  const [collectionId, setCollectionId] = useState<string | null>(detail.collectionId ?? null);
  const [collections, setCollections] = useState<CardCollection[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<Record<"expression" | "translation" | "reply", boolean>>({
    expression: Boolean(detail.rewrittenText),
    translation: Boolean(detail.translationText),
    reply: Boolean(detail.replyText),
  });
  const [photoRailVisible, setPhotoRailVisible] = useState(false);
  const [recentPhotos, setRecentPhotos] = useState<MediaLibrary.Asset[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const images = useMemo(
    () => detail.images?.length ? detail.images : detail.image ? [detail.image] : [],
    [detail.images, detail.image],
  );
  const originalStt = useRealtimeSttInput({ value: originalText, onChangeText: setOriginalText, disabled: saving });
  useEffect(() => { void getCardCollections().then((value) => setCollections(value.collections)).catch(() => undefined); }, []);
  const dirty = title !== (detail.title ?? "")
    || originalText !== detail.originalText
    || selectedTargets.expression !== Boolean(detail.rewrittenText)
    || selectedTargets.translation !== Boolean(detail.translationText)
    || selectedTargets.reply !== Boolean(detail.replyText)
    || collectionId !== (detail.collectionId ?? null);
  const contentCount = countGraphemes(originalText);
  const canSave = contentCount > 0 && contentCount <= limits.contentChars && !saving;
  async function save(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim() || null,
        originalText: originalText.trim(),
        collectionId,
        selectedTargets: (["expression", "translation", "reply"] as const).filter((target) => selectedTargets[target]),
      });
    } catch (error) {
      Alert.alert(t("card_detail.error.save"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
    } finally {
      setSaving(false);
    }
  }
  function cancel(): void {
    if (!dirty) { onCancel(); return; }
    Alert.alert(t("card_detail.unsaved_title"), t("card_detail.unsaved_message"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("card_detail.discard_changes"), style: "destructive", onPress: onCancel },
    ]);
  }
  async function togglePhotoRail(): Promise<void> {
    if (photoRailVisible) { setPhotoRailVisible(false); return; }
    Keyboard.dismiss();
    setPhotoRailVisible(true);
    setPhotosLoading(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
      if (!permission.granted) {
        Alert.alert(t("card_detail.photo.permission_title"), t("card_detail.photo.permission_message"));
        setPhotoRailVisible(false);
        return;
      }
      const page = await MediaLibrary.getAssetsAsync({ first: 20, mediaType: MediaLibrary.MediaType.photo, sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
      setRecentPhotos(page.assets);
    } catch {
      setPhotoRailVisible(false);
      Alert.alert(t("card_detail.photo.read_failed_title"), t("card_detail.photo.read_failed_message"));
    } finally { setPhotosLoading(false); }
  }
  function openImageActions(): void {
    const recentPhotoLimit = Platform.OS === "ios" ? Math.min(8, limits.imagesPerCard) : limits.imagesPerCard;
    if (images.length >= recentPhotoLimit) {
      Alert.alert(t("card_detail.photo.limit_title"), t("card_detail.photo.limit_message"));
      return;
    }
    Keyboard.dismiss();
    if (Platform.OS === "ios") void togglePhotoRail();
    else onAddImage?.("library");
  }
  async function selectRecentPhotos(assets: MediaLibrary.Asset[]): Promise<void> {
    try {
      for (const asset of assets.slice(0, Math.max(0, limits.imagesPerCard - images.length))) {
        const info = await MediaLibrary.getAssetInfoAsync(asset);
        await onAddImage?.("library", { uri: info.localUri || info.uri, width: info.width, height: info.height });
      }
      setPhotoRailVisible(false);
    } catch {
      Alert.alert(t("card_detail.photo.asset_failed_title"), t("card_detail.photo.asset_failed_message"));
    }
  }
  return <View style={styles.fullscreen}>
    <SafeAreaView style={styles.page}>
      <CardEditorHeader title={t("card_detail.edit_card")} disabled={saving} onClose={cancel} />
      <KeyboardAvoidingView style={styles.draftContentPage} behavior="height">
        <>
          <ScrollView style={styles.draftEditorScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.draftEditorContent} showsVerticalScrollIndicator={false} alwaysBounceVertical={false} bounces={false}>
            <CardImageGallery images={detailGalleryImages(images, detail.thumbnail?.url)} loading={imageAdding} dateLabel={`${formatDate(detail.dateKey)} · ${formatTime(detail.createdAt)}`} onRemove={onRemoveImage} onCoverPositionChange={onCoverPositionChange} />
            <CollectionPickerRow collections={collections} value={collectionId} onChange={setCollectionId} />
            <TextInput value={title} editable={!saving} maxLength={limits.titleChars} placeholder={t("card_detail.title_optional")} placeholderTextColor={theme.colors.textMuted} style={styles.draftTitleInput} onChangeText={setTitle} />
            <View style={styles.draftOriginalEditor}>
              <TextInput multiline scrollEnabled={false} value={originalText} editable={!saving} onChangeText={originalStt.onChangeText} onSelectionChange={(event) => originalStt.onSelectionChange(event.nativeEvent.selection)} maxLength={limits.contentChars} placeholder={t("card_detail.original_placeholder")} placeholderTextColor={theme.colors.textMuted} style={[styles.draftBlockInput, styles.draftBlockInputFeatured]} textAlignVertical="top" />
            </View>
          </ScrollView>
          {Platform.OS === "ios" && photoRailVisible ? <RecentPhotoLayer assets={recentPhotos} loading={photosLoading} maxSelection={Math.min(8, Math.max(0, limits.imagesPerCard - images.length))} onDismiss={() => setPhotoRailVisible(false)} onSelect={(assets) => void selectRecentPhotos(assets)} onTakePhoto={() => { setPhotoRailVisible(false); onAddImage?.("camera"); }} onOpenAll={() => { setPhotoRailVisible(false); onAddImage?.("library"); }} /> : null}
        </>
        <DraftAiOptionsRow
          selected={selectedTargets}
          disabled={saving}
          onToggle={(target) => {
            setSelectedTargets((current) => ({ ...current, [target]: !current[target] }));
          }}
        />
        <DraftComposerToolbar
          imageCount={images.length}
          sttStatus={originalStt.status}
          sttAudioLevel={originalStt.audioLevel}
          disabled={saving}
          onCamera={() => onAddImage?.("camera")}
          onRecentPhotos={openImageActions}
          onStt={() => void originalStt.toggle()}
          characterCount={contentCount}
          characterLimit={limits.contentChars}
          canSave={canSave}
          onInvalidSave={() => showNotice({ message: tf("card_detail.error.content_limit", { count: limits.contentChars }), type: "info", position: "top-center" })}
          onSave={() => void save()}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  </View>;
}

function DraftCard({ draft, sending, imageAdding, safeArea, limits, collections, onClose, onChangeText, onChangeField, onEnabledLayersChange, onCollectionChange, onCreateCollection, onRenameCollection, onDeleteCollection, onSave, onChooseImage, onTakePhoto, onSelectImage, onRemoveImage, onCoverPositionChange }: {
  draft: CardDraft;
  sending: boolean;
  imageAdding: boolean;
  safeArea?: { top: number; bottom: number };
  limits: CardCapabilities["limits"];
  collections: CardCollection[];
  onClose: () => void;
  onChangeText?: (text: string) => void;
  onChangeField?: (field: "title" | "rewrittenText" | "translationText" | "replyText", value: string) => void;
  onEnabledLayersChange?: (layers: CardDraft["enabledLayers"]) => void;
  onCollectionChange?: (collectionId: string | null) => void;
  onCreateCollection?: (name: string, parentId: string | null) => Promise<CardCollection>;
  onRenameCollection?: (collectionId: string, name: string) => Promise<void>;
  onDeleteCollection?: (collection: CardCollection) => Promise<void>;
  onSave?: (initialTab?: DetailTab) => void;
  onChooseImage?: () => void;
  onTakePhoto?: () => void;
  onSelectImage?: (asset: { uri: string; width: number; height: number }) => Promise<void> | void;
  onRemoveImage?: (localUri?: string) => void;
  onCoverPositionChange?: (localUri: string, focusX: number, focusY: number) => Promise<void> | void;
}) {
  const { showNotice } = useFloatingNotice();
  const processing = draft.submitted;
  const count = countGraphemes(draft.text);
  const imagesReady = draft.images.every((image) => image.status === "ready");
  const canSave = count > 0 && count <= limits.contentChars && imagesReady;
  const [photoRailVisible, setPhotoRailVisible] = useState(false);
  const [recentPhotos, setRecentPhotos] = useState<MediaLibrary.Asset[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const editorScrollRef = useRef<ScrollView>(null);
  const originalInputRef = useRef<TextInput>(null);
  const originalSelectionRef = useRef({ start: draft.text.length, end: draft.text.length });
  const followOriginalInputRef = useRef(true);
  const originalStt = useRealtimeSttInput({ value: draft.text, onChangeText, disabled: sending });
  useEffect(() => {
    const timer = setTimeout(() => originalInputRef.current?.focus(), 320);
    return () => clearTimeout(timer);
  }, []);
  async function togglePhotoRail(): Promise<void> {
    if (photoRailVisible) { setPhotoRailVisible(false); return; }
    Keyboard.dismiss();
    setPhotoRailVisible(true);
    setPhotosLoading(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
      if (!permission.granted) {
        Alert.alert(t("card_detail.photo.permission_title"), t("card_detail.photo.permission_message"));
        setPhotoRailVisible(false);
        return;
      }
      const page = await MediaLibrary.getAssetsAsync({ first: 20, mediaType: MediaLibrary.MediaType.photo, sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
      setRecentPhotos(page.assets);
    } catch {
      setPhotoRailVisible(false);
      Alert.alert(t("card_detail.photo.read_failed_title"), t("card_detail.photo.read_failed_message"));
    } finally { setPhotosLoading(false); }
  }
  function openImageActions(): void {
    const recentPhotoLimit = Platform.OS === "ios" ? Math.min(8, limits.imagesPerCard) : limits.imagesPerCard;
    if (draft.images.length >= recentPhotoLimit) {
      Alert.alert(t("card_detail.photo.limit_title"), t("card_detail.photo.limit_message"));
      return;
    }
    Keyboard.dismiss();
    if (Platform.OS === "ios") void togglePhotoRail();
    else onChooseImage?.();
  }
  async function selectRecentPhotos(assets: MediaLibrary.Asset[]): Promise<void> {
    try {
      for (const asset of assets.slice(0, Math.max(0, limits.imagesPerCard - draft.images.length))) {
        const info = await MediaLibrary.getAssetInfoAsync(asset);
        await onSelectImage?.({ uri: info.localUri || info.uri, width: info.width, height: info.height });
      }
      setPhotoRailVisible(false);
    } catch {
      Alert.alert(t("card_detail.photo.asset_failed_title"), t("card_detail.photo.asset_failed_message"));
    }
  }
  function confirmRemoveDraftImage(localUri: string): void {
    Alert.alert(t("card_detail.photo.remove_title"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => onRemoveImage?.(localUri) },
    ]);
  }
  return (
    <View style={styles.fullscreen}>
      <SafeAreaView edges={safeArea ? [] : undefined} style={[styles.page, safeArea ? { paddingTop: safeArea.top, paddingBottom: safeArea.bottom } : null]}>
        <CardEditorHeader title={t("card_detail.create_card")} disabled={sending} onClose={onClose} />
        {processing ? (
          <ScrollView contentContainerStyle={styles.draftContent} showsVerticalScrollIndicator={false} alwaysBounceVertical={false} bounces={false}>
            <Text style={styles.date}>{formatDraftDate()}</Text>
            {draft.images[0] ? <Image source={{ uri: draft.images[0].localUri }} style={styles.draftImage} resizeMode="cover" /> : null}
            <Text style={styles.original}>{draft.text}</Text>
            <View style={styles.divider} />
            <DraftProcessingLines />
          </ScrollView>
        ) : (
          <KeyboardAvoidingView style={styles.draftContentPage} behavior="height">
            <>
            <ScrollView
              ref={editorScrollRef}
              style={styles.draftEditorScroll}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={styles.draftEditorContent}
              showsVerticalScrollIndicator={false}
              alwaysBounceVertical={false}
              bounces={false}
            >
              <CollectionPickerRow collections={collections} value={draft.collectionId} onChange={(collectionId) => onCollectionChange?.(collectionId)} onCreateCollection={onCreateCollection} onRenameCollection={onRenameCollection} onDeleteCollection={onDeleteCollection} />
              <TextInput
                value={draft.title}
                editable={!sending}
                maxLength={limits.titleChars}
                placeholder={t("card_detail.title_optional")}
                placeholderTextColor={theme.colors.textMuted}
                style={styles.draftTitleInput}
                onChangeText={(value) => onChangeField?.("title", value)}
              />
              <CardImageGallery
                images={draft.images.map((image) => ({
                  key: image.localUri,
                  url: image.localUri,
                  thumbnailUrl: image.localUri,
                  width: image.width,
                  height: image.height,
                  focusX: image.focusX,
                  focusY: image.focusY,
                  status: image.status === "pending" ? "uploading" : image.status === "uploading" || image.status === "moderating" || image.status === "failed" ? image.status : undefined,
                }))}
                loading={imageAdding}
                dateLabel={formatDraftDate()}
                onRemove={confirmRemoveDraftImage}
                onCoverPositionChange={onCoverPositionChange ? async (localUri, focusX, focusY) => { await onCoverPositionChange(localUri, focusX, focusY); } : undefined}
              />
              <View style={styles.draftOriginalEditor}>
                <TextInput
                  ref={originalInputRef}
                  multiline
                  scrollEnabled={false}
                  showSoftInputOnFocus
                  value={draft.text}
                  editable={!sending}
                  maxLength={limits.contentChars}
                  placeholder={t("card_detail.original_placeholder")}
                  placeholderTextColor={theme.colors.textMuted}
                  style={[styles.draftBlockInput, styles.draftBlockInputFeatured]}
                  textAlignVertical="top"
                  onChangeText={(value) => {
                    followOriginalInputRef.current = originalSelectionRef.current.end >= draft.text.length;
                    originalStt.onChangeText(value);
                  }}
                  onSelectionChange={(event) => {
                    originalSelectionRef.current = event.nativeEvent.selection;
                    originalStt.onSelectionChange(event.nativeEvent.selection);
                  }}
                  onContentSizeChange={() => {
                    if (!followOriginalInputRef.current) return;
                    requestAnimationFrame(() => editorScrollRef.current?.scrollToEnd({ animated: false }));
                  }}
                />
              </View>
            </ScrollView>
            {Platform.OS === "ios" && photoRailVisible ? <RecentPhotoLayer assets={recentPhotos} loading={photosLoading} maxSelection={Math.min(8, Math.max(0, limits.imagesPerCard - draft.images.length))} onDismiss={() => setPhotoRailVisible(false)} onSelect={(assets) => void selectRecentPhotos(assets)} onTakePhoto={() => { setPhotoRailVisible(false); onTakePhoto?.(); }} onOpenAll={() => { setPhotoRailVisible(false); onChooseImage?.(); }} /> : null}
            </>
            <DraftAiOptionsRow
              selected={draft.enabledLayers}
              disabled={sending}
              onToggle={(target) => onEnabledLayersChange?.({ ...draft.enabledLayers, [target]: !draft.enabledLayers[target] })}
            />
            <DraftComposerToolbar
              imageCount={draft.images.length}
              sttStatus={originalStt.status}
              sttAudioLevel={originalStt.audioLevel}
              disabled={sending}
              onCamera={() => onTakePhoto?.()}
              onRecentPhotos={openImageActions}
              onStt={() => {
                originalInputRef.current?.focus();
                setTimeout(() => void originalStt.toggle(), 0);
              }}
              characterCount={count}
              characterLimit={limits.contentChars}
              canSave={canSave}
              onInvalidSave={count < 1 || count > limits.contentChars ? () => showNotice({ message: tf("card_detail.error.content_limit", { count: limits.contentChars }), type: "info", position: "top-center" }) : undefined}
              onSave={() => onSave?.("review")}
            />
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </View>
  );
}

function RecentPhotoLayer({ assets, loading, maxSelection, onDismiss, onSelect, onTakePhoto, onOpenAll }: {
  assets: MediaLibrary.Asset[];
  loading: boolean;
  maxSelection: number;
  onDismiss: () => void;
  onSelect: (assets: MediaLibrary.Asset[]) => void;
  onTakePhoto: () => void;
  onOpenAll: () => void;
}) {
  const { height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const dismissingRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);
  function dismiss(afterDismiss?: () => void): void {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    Animated.timing(progress, {
      toValue: 0,
      duration: 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onDismiss();
        afterDismiss?.();
      } else {
        dismissingRef.current = false;
      }
    });
  }
  return <View style={styles.photoLayer}>
    <Animated.View style={[styles.photoLayerDismiss, { opacity: progress }]}>
      <Pressable accessibilityLabel={t("card_detail.a11y.close_recent_photos")} style={StyleSheet.absoluteFill} onPress={() => dismiss()} />
    </Animated.View>
    <Animated.View style={[styles.photoLayerPanel, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [Math.max(330, height * 0.58), 0] }) }] }]}>
      <View style={styles.photoLayerHeader}>
        <Text style={styles.photoLayerTitle}>{t("card_detail.photo.recent")}</Text>
        {selectedIds.length ? <Pressable hitSlop={8} style={styles.photoLayerDone} onPress={() => dismiss(() => onSelect(selectedIds.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is MediaLibrary.Asset => Boolean(asset))))}><Text style={styles.photoLayerDoneText}>{t("common.confirm")} ({selectedIds.length})</Text></Pressable> : <Pressable accessibilityLabel={t("card_detail.a11y.close_recent_photos")} hitSlop={8} style={styles.photoLayerClose} onPress={() => dismiss()}><Ionicons name="close" size={21} color={theme.colors.text} /></Pressable>}
      </View>
      <ScrollView style={styles.photoGridScroll} contentContainerStyle={styles.photoGrid} showsVerticalScrollIndicator={false}>
        {loading ? <View style={styles.photoGridLoading}><ActivityIndicator color={theme.colors.textMuted} /></View> : null}
        {assets.map((asset) => { const selectedIndex = selectedIds.indexOf(asset.id); return <Pressable key={asset.id} accessibilityLabel={tf("card_detail.a11y.choose_photo", { filename: asset.filename })} style={[styles.photoGridItem, selectedIndex >= 0 && styles.photoGridItemSelected]} onPress={() => setSelectedIds((current) => {
          if (current.includes(asset.id)) return current.filter((id) => id !== asset.id);
          if (current.length >= maxSelection) { Alert.alert(tf("card_detail.photo.selection_limited", { count: maxSelection })); return current; }
          return [...current, asset.id];
        })}>
          <Image source={{ uri: asset.uri }} style={styles.photoRailImage} />
          {selectedIndex >= 0 ? <View style={styles.photoSelectionBadge}><Text style={styles.photoSelectionBadgeText}>{selectedIndex + 1}</Text></View> : null}
        </Pressable>; })}
      </ScrollView>
      <View style={styles.photoLayerActions}>
        <Pressable accessibilityLabel={t("card_detail.a11y.take_photo")} style={styles.photoLayerAction} onPress={() => dismiss(onTakePhoto)}>
          <Ionicons name="camera-outline" size={20} color={theme.colors.text} />
          <Text style={styles.photoLayerActionText}>{t("card_detail.photo.camera")}</Text>
        </Pressable>
        <Pressable accessibilityLabel={t("card_detail.a11y.open_all_photos")} style={styles.photoLayerAction} onPress={() => dismiss(onOpenAll)}>
          <Ionicons name="images-outline" size={20} color={theme.colors.text} />
          <Text style={styles.photoLayerActionText}>{t("card_detail.photo.library")}</Text>
        </Pressable>
      </View>
    </Animated.View>
  </View>;
}

type DictationSentence = { key: string; text: string };

type DictationWord = {
  index: number;
  start: number;
  end: number;
  normalized: string;
};

type DictationWordComparison = {
  actualWords: DictationWord[];
  expectedWords: DictationWord[];
  matchedActual: Set<number>;
  matchedExpected: Set<number>;
  correct: boolean;
};

function segmentDictationWords(value: string): DictationWord[] {
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: "word" },
    ) => { segment(text: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }> };
  }).Segmenter;
  if (Segmenter) {
    return Array.from(new Segmenter(getLanguage(), { granularity: "word" }).segment(value))
      .filter(({ segment, isWordLike }) => isWordLike ?? /[\p{L}\p{M}\p{N}]/u.test(segment))
      .map(({ segment, index }, wordIndex) => ({
        index: wordIndex,
        start: index,
        end: index + segment.length,
        normalized: normalizeDictationWord(segment),
      }));
  }
  const words: DictationWord[] = [];
  const pattern = /[\p{Script=Han}]|[\p{Script=Hiragana}\p{Script=Katakana}]+|[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    words.push({
      index: words.length,
      start,
      end: start + match[0].length,
      normalized: normalizeDictationWord(match[0]),
    });
  }
  return words;
}

function normalizeDictationWord(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/’/g, "'");
}

function compareDictationWords(actualText: string, expectedText: string): DictationWordComparison {
  const actualWords = segmentDictationWords(actualText);
  const expectedWords = segmentDictationWords(expectedText);
  const rows = actualWords.length + 1;
  const columns = expectedWords.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let actualIndex = 1; actualIndex < rows; actualIndex += 1) {
    for (let expectedIndex = 1; expectedIndex < columns; expectedIndex += 1) {
      table[actualIndex][expectedIndex] = actualWords[actualIndex - 1].normalized === expectedWords[expectedIndex - 1].normalized
        ? table[actualIndex - 1][expectedIndex - 1] + 1
        : Math.max(table[actualIndex - 1][expectedIndex], table[actualIndex][expectedIndex - 1]);
    }
  }
  const matchedActual = new Set<number>();
  const matchedExpected = new Set<number>();
  let actualIndex = actualWords.length;
  let expectedIndex = expectedWords.length;
  while (actualIndex > 0 && expectedIndex > 0) {
    if (actualWords[actualIndex - 1].normalized === expectedWords[expectedIndex - 1].normalized) {
      matchedActual.add(actualIndex - 1);
      matchedExpected.add(expectedIndex - 1);
      actualIndex -= 1;
      expectedIndex -= 1;
    } else if (table[actualIndex - 1][expectedIndex] >= table[actualIndex][expectedIndex - 1]) {
      actualIndex -= 1;
    } else {
      expectedIndex -= 1;
    }
  }
  const correct = actualWords.length > 0
    && actualWords.length === expectedWords.length
    && matchedActual.size === actualWords.length;
  return { actualWords, expectedWords, matchedActual, matchedExpected, correct };
}

function renderDictationWordResult(text: string, words: DictationWord[], matched: Set<number>): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  words.forEach((word) => {
    if (cursor < word.start) nodes.push(<Text key={`plain-${cursor}`}>{text.slice(cursor, word.start)}</Text>);
    nodes.push(
      <Text key={`word-${word.index}-${word.start}`} style={matched.has(word.index) ? styles.correct : styles.incorrect}>
        {text.slice(word.start, word.end)}
      </Text>,
    );
    cursor = word.end;
  });
  if (cursor < text.length) nodes.push(<Text key={`plain-${cursor}`}>{text.slice(cursor)}</Text>);
  return nodes;
}

function DictationPracticeView({ sentences, onPlay }: {
  sentences: DictationSentence[];
  onPlay: (sentence: DictationSentence) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, "correct" | "incorrect">>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  useEffect(() => { setAnswers({}); setChecked({}); setRevealed({}); }, [sentences.map((sentence) => sentence.key).join("|")]);
  async function play(sentence: DictationSentence): Promise<void> {
    if (speakingKey) return;
    setSpeakingKey(sentence.key);
    try { await onPlay(sentence); } finally { setSpeakingKey(null); }
  }
  function checkSentence(sentence: DictationSentence): void {
    if (!answers[sentence.key]?.trim()) return;
    const comparison = compareDictationWords(answers[sentence.key] ?? "", sentence.text);
    setChecked((current) => ({ ...current, [sentence.key]: comparison.correct ? "correct" : "incorrect" }));
  }
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.practiceContent} alwaysBounceVertical={false}>
    <View style={styles.dictationSentenceList}>{sentences.map((sentence, index) => {
      const result = checked[sentence.key];
      const answer = answers[sentence.key] ?? "";
      const comparison = result ? compareDictationWords(answer, sentence.text) : null;
      return <View key={sentence.key} style={styles.dictationSentenceRow}>
        <View style={styles.dictationSentenceBody}>
          <Text style={styles.dictationSentenceNumber}>{index + 1}</Text>
          <View style={styles.dictationSentenceInputStack}>
            <View pointerEvents="none" style={styles.dictationSentenceTextOverlay}>
              <Text style={styles.dictationSentenceDisplayText}>
                {comparison
                  ? renderDictationWordResult(answer, comparison.actualWords, comparison.matchedActual)
                  : answer}
              </Text>
            </View>
            <TextInput multiline scrollEnabled={false} value={answer} onChangeText={(value) => {
              setAnswers((current) => ({ ...current, [sentence.key]: value }));
              setChecked((current) => { const next = { ...current }; delete next[sentence.key]; return next; });
              setRevealed((current) => { const next = { ...current }; delete next[sentence.key]; return next; });
            }} style={styles.dictationSentenceInput} placeholder="" placeholderTextColor={theme.colors.textMuted} selectionColor={theme.colors.accentStrong} textAlignVertical="top" />
          </View>
          <View style={styles.dictationSentenceActions}>
            <Pressable accessibilityLabel={tf("card_detail.a11y.check_sentence", { index: index + 1 })} disabled={!answer.trim()} style={[styles.dictationSentenceAction, !answer.trim() && styles.dictationSentenceActionDisabled]} onPress={() => checkSentence(sentence)}><Ionicons name={result === "correct" ? "checkmark-circle" : "checkmark-circle-outline"} size={21} color={result === "correct" ? theme.colors.success : theme.colors.textSecondary} /></Pressable>
            <Pressable accessibilityLabel={tf("card_detail.a11y.show_sentence_answer", { index: index + 1 })} style={styles.dictationSentenceAction} onPress={() => setRevealed((current) => ({ ...current, [sentence.key]: !current[sentence.key] }))}><Ionicons name={revealed[sentence.key] ? "eye-off-outline" : "eye-outline"} size={21} color={theme.colors.textSecondary} /></Pressable>
            <Pressable accessibilityLabel={tf("card_detail.a11y.play_sentence_number", { index: index + 1 })} style={styles.dictationSentenceAction} disabled={Boolean(speakingKey)} onPress={() => void play(sentence)}>{speakingKey === sentence.key ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : <Ionicons name="volume-high-outline" size={20} color={theme.colors.textSecondary} />}</Pressable>
          </View>
          {revealed[sentence.key] ? <Text selectable style={styles.dictationSentenceAnswer}>{sentence.text}</Text> : null}
        </View>
      </View>;
    })}</View>
  </ScrollView>;
}

function CollectionPickerRow({ collections, value, onChange, onCreateCollection, onRenameCollection, onDeleteCollection }: {
  collections: CardCollection[];
  value: string | null;
  onChange: (collectionId: string | null) => void;
  onCreateCollection?: (name: string, parentId: string | null) => Promise<CardCollection>;
  onRenameCollection?: (collectionId: string, name: string) => Promise<void>;
  onDeleteCollection?: (collection: CardCollection) => Promise<void>;
}) {
  const [visible, setVisible] = useState(false);
  const selected = collections.find((collection) => collection.id === value);
  return <>
    <Pressable accessibilityLabel={t("card_detail.a11y.choose_collection")} style={styles.collectionPickerRow} onPress={() => setVisible(true)}>
      <View style={styles.collectionPickerLabel}><Ionicons name="folder-outline" size={17} color={theme.colors.textMuted} /><Text style={styles.collectionPickerLabelText}>{t("card_detail.collection")}</Text></View>
      <Text numberOfLines={1} style={styles.collectionPickerValue}>{selected ? collectionPathName(selected, collections) : t("sidebar.unclassified")}</Text>
      <Ionicons name="chevron-forward" size={17} color={theme.colors.textMuted} />
    </Pressable>
    <CollectionPickerModal visible={visible} title={t("card_detail.choose_collection")} collections={collections} value={value} onClose={() => setVisible(false)} onSelect={(collectionId) => onChange(collectionId ?? null)} onCreateCollection={onCreateCollection} onRenameCollection={onRenameCollection} onDeleteCollection={onDeleteCollection} />
  </>;
}

function DraftAiOptionsRow({ selected, disabled, onToggle }: {
  selected: Record<"expression" | "translation" | "reply", boolean>;
  disabled: boolean;
  onToggle: (key: "expression" | "translation" | "reply") => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.15;
  const items = [
    { key: "translation" as const, label: t("card_detail.module.translation_description") },
    { key: "reply" as const, label: t("card_detail.module.reply_description") },
    { key: "expression" as const, label: t("card_detail.module.expression_description") },
  ];
  return <View style={[styles.draftAiOptionsRow, stacked && styles.draftAiOptionsRowStacked]}>
    {items.map((item) => <Pressable key={item.key} disabled={disabled} style={[styles.draftAiOption, stacked && styles.draftAiOptionStacked]} onPress={() => onToggle(item.key)}>
      <Ionicons name={selected[item.key] ? "checkmark-circle" : "ellipse-outline"} size={18} color={selected[item.key] ? theme.colors.accentStrong : theme.colors.textMuted} />
      <Text numberOfLines={stacked ? undefined : 1} style={[styles.draftAiOptionLabel, stacked && styles.draftAiOptionLabelStacked, selected[item.key] && styles.draftAiOptionLabelSelected]}>{item.label}</Text>
    </Pressable>)}
  </View>;
}

function DraftComposerToolbar({ imageCount, sttStatus, sttAudioLevel, disabled, onCamera, onRecentPhotos, onStt, characterCount, characterLimit, canSave, onInvalidSave, onSave }: {
  imageCount: number;
  sttStatus: RealtimeSttInputStatus;
  sttAudioLevel: number;
  disabled: boolean;
  onCamera: () => void;
  onRecentPhotos: () => void;
  onStt: () => void;
  characterCount?: number;
  characterLimit?: number;
  canSave?: boolean;
  onInvalidSave?: () => void;
  onSave?: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 360 || fontScale > 1.15;
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress]);
  const tools: Array<{
    key: string;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    count?: number;
    onPress: () => void;
  }> = [
    { key: "camera", label: t("card_detail.photo.camera"), icon: "camera-outline", onPress: onCamera },
    { key: "recent", label: t("card_detail.photo.recent"), icon: "images-outline", count: imageCount, onPress: onRecentPhotos },
  ];
  return <Animated.View style={[styles.draftComposerToolbar, compact && styles.draftComposerToolbarCompact, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }] }>
    {tools.map((tool) => <Pressable
      key={tool.key}
      accessibilityLabel={tool.label}
      disabled={disabled}
      style={[styles.draftComposerTool, compact && styles.draftComposerToolCompact]}
      onPress={tool.onPress}
    >
      <Ionicons name={tool.icon} size={21} color={theme.colors.text} />
      {tool.count ? <View style={styles.draftComposerBadge}><Text style={styles.draftComposerBadgeText}>{tool.count}</Text></View> : null}
    </Pressable>)}
    <RealtimeSttButton status={sttStatus} audioLevel={sttAudioLevel} disabled={disabled} style={[styles.draftComposerTool, compact && styles.draftComposerToolCompact]} onPress={onStt} />
    <View style={styles.draftComposerSpacer} />
    {typeof characterCount === "number" && typeof characterLimit === "number" ? <Text accessibilityLabel={`${characterCount}/${characterLimit}`} style={[styles.draftCharacterCount, characterCount > characterLimit && styles.draftCharacterCountOver]}>{compact ? characterCount : `${characterCount}/${characterLimit}`}</Text> : null}
    {onSave ? <Pressable accessibilityLabel={t("card_detail.done")} disabled={disabled || (!canSave && !onInvalidSave)} style={[styles.draftPublishButton, compact && styles.draftPublishButtonCompact, (disabled || !canSave) && styles.draftPublishButtonDisabled]} onPress={canSave ? onSave : onInvalidSave}>
      <Text style={[styles.draftPublishButtonText, (disabled || !canSave) && styles.draftPublishButtonTextDisabled]}>{t("card_detail.done")}</Text>
    </Pressable> : null}
  </Animated.View>;
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
  return new Date().toLocaleDateString(getLanguage(), { month: "long", day: "numeric", weekday: "short" });
}

function countGraphemes(value: string): number {
  const normalized = value.replace(/\r\n?/gu, "\n");
  const Segmenter = (Intl as unknown as { Segmenter?: new (...args: unknown[]) => { segment: (text: string) => Iterable<unknown> } }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(normalized)).length : Array.from(normalized).length;
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

type GalleryImage = {
  key: string;
  url: string;
  thumbnailUrl: string;
  width?: number;
  height?: number;
  focusX?: number;
  focusY?: number;
  status?: "uploading" | "moderating" | "failed";
  placeholder?: boolean;
};
type ImagePreviewOrigin = { x: number; y: number; width: number; height: number };
const CARD_IMAGE_ASPECT_RATIO = 16 / 9;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

function FocusedCoverImage({ image, frameWidth }: { image: GalleryImage; frameWidth: number }) {
  const frameHeight = frameWidth / CARD_IMAGE_ASPECT_RATIO;
  const sourceRatio = Math.max(0.01, (image.width ?? frameWidth) / Math.max(1, image.height ?? frameHeight));
  const renderedWidth = sourceRatio >= CARD_IMAGE_ASPECT_RATIO ? frameHeight * sourceRatio : frameWidth;
  const renderedHeight = sourceRatio >= CARD_IMAGE_ASPECT_RATIO ? frameHeight : frameWidth / sourceRatio;
  const left = -clampUnit(image.focusX ?? 0.5) * Math.max(0, renderedWidth - frameWidth);
  const top = -clampUnit(image.focusY ?? 0.5) * Math.max(0, renderedHeight - frameHeight);
  return <Image source={{ uri: image.thumbnailUrl }} resizeMode="stretch" fadeDuration={0} progressiveRenderingEnabled style={{ position: "absolute", left, top, width: renderedWidth, height: renderedHeight }} />;
}

function PreviewCoverCropOverlay({ image, width, height, onCommit }: {
  image: GalleryImage;
  width: number;
  height: number;
  onCommit: (focusY: number) => Promise<void>;
}) {
  const sourceWidth = Math.max(1, image.width ?? width);
  const sourceHeight = Math.max(1, image.height ?? height);
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  const displayX = (width - displayWidth) / 2;
  // The preview item is explicitly top-aligned (`justifyContent: flex-start`).
  // Keep the crop geometry in that same coordinate system.
  const displayY = 0;
  const frameHeightFromWidth = displayWidth / CARD_IMAGE_ASPECT_RATIO;
  const frameWidth = frameHeightFromWidth <= displayHeight ? displayWidth : displayHeight * CARD_IMAGE_ASPECT_RATIO;
  const frameHeight = frameWidth / CARD_IMAGE_ASPECT_RATIO;
  const frameX = displayX + (displayWidth - frameWidth) / 2;
  const travel = Math.max(0, displayHeight - frameHeight);
  const [focusY, setFocusY] = useState(clampUnit(image.focusY ?? 0.5));
  const focusRef = useRef(focusY);
  const dragStartRef = useRef(focusY);
  useEffect(() => {
    const next = clampUnit(image.focusY ?? 0.5);
    focusRef.current = next;
    setFocusY(next);
  }, [image.focusY, image.key]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => travel > 1,
    onStartShouldSetPanResponder: () => travel > 1,
    onMoveShouldSetPanResponderCapture: (_event, gesture) => travel > 1 && Math.abs(gesture.dy) > 3 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onMoveShouldSetPanResponder: (_event, gesture) => travel > 1 && Math.abs(gesture.dy) > 3 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { dragStartRef.current = focusRef.current; },
    onPanResponderMove: (_event, gesture) => {
      const next = clampUnit(dragStartRef.current + gesture.dy / Math.max(1, travel));
      focusRef.current = next;
      setFocusY(next);
    },
    onPanResponderRelease: () => { void onCommit(focusRef.current).catch(() => undefined); },
    onPanResponderTerminate: () => { void onCommit(focusRef.current).catch(() => undefined); },
  }), [onCommit, travel]);
  const frameY = displayY + focusY * travel;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.previewCropOverlay]}>
    <View pointerEvents="none" style={[styles.cropShade, { left: displayX, top: displayY, width: displayWidth, height: Math.max(0, frameY - displayY) }]} />
    <View pointerEvents="none" style={[styles.cropShade, { left: displayX, top: frameY + frameHeight, width: displayWidth, height: Math.max(0, displayY + displayHeight - frameY - frameHeight) }]} />
    <View pointerEvents="none" style={[styles.cropShade, { left: displayX, top: frameY, width: Math.max(0, frameX - displayX), height: frameHeight }]} />
    <View pointerEvents="none" style={[styles.cropShade, { left: frameX + frameWidth, top: frameY, width: Math.max(0, displayX + displayWidth - frameX - frameWidth), height: frameHeight }]} />
    <View accessibilityRole="adjustable" {...responder.panHandlers} style={[styles.previewCropFrame, { left: frameX, top: frameY, width: frameWidth, height: frameHeight }]} />
  </View>;
}

const CardImageGallery = React.memo(function CardImageGallery({ images, loading = false, dateLabel, onRemove, onCoverPositionChange }: {
  images: GalleryImage[];
  loading?: boolean;
  dateLabel?: string;
  onRemove?: (imageKey: string) => void;
  onCoverPositionChange?: (imageKey: string, focusX: number, focusY: number) => Promise<void>;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const pageWidth = windowWidth - 44;
  const displayImages = loading
    ? [...images, { key: "__adding_image__", url: "", thumbnailUrl: "", placeholder: true }]
    : images;
  const galleryRef = useRef<FlatList<GalleryImage>>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewOrigin, setPreviewOrigin] = useState<ImagePreviewOrigin | null>(null);
  const thumbnailRefs = useRef(new Map<string, View>());

  useEffect(() => {
    setImageIndex((current) => Math.min(current, Math.max(displayImages.length - 1, 0)));
    setPreviewIndex((current) => current === null ? null : images.length ? Math.min(current, images.length - 1) : null);
  }, [displayImages.length, images.length]);
  useEffect(() => {
    if (!displayImages.length) return;
    const targetIndex = loading ? displayImages.length - 1 : Math.min(imageIndex, displayImages.length - 1);
    const frame = requestAnimationFrame(() => {
      galleryRef.current?.scrollToOffset({ offset: targetIndex * pageWidth, animated: loading });
      setImageIndex(targetIndex);
    });
    return () => cancelAnimationFrame(frame);
  }, [displayImages.length, loading, pageWidth]);

  if (!displayImages.length) return null;

  return (
    <View>
      <FlatList
        ref={galleryRef}
        horizontal
        data={displayImages}
        keyExtractor={(image) => image.key}
        renderItem={({ item: image, index }) => (
          <Pressable
            ref={(node) => {
              if (node) thumbnailRefs.current.set(image.key, node);
              else thumbnailRefs.current.delete(image.key);
            }}
            accessibilityRole="imagebutton"
            accessibilityLabel={tf("card_detail.a11y.preview_image", { index: index + 1 })}
            style={[styles.carouselImagePage, { width: pageWidth, aspectRatio: CARD_IMAGE_ASPECT_RATIO }]}
            disabled={image.placeholder}
            onPress={() => {
              const node = thumbnailRefs.current.get(image.key);
              if (!node) {
                setPreviewOrigin(null);
                setPreviewIndex(index);
                return;
              }
              node.measureInWindow((x, y, width, height) => {
                setPreviewOrigin({ x, y, width, height });
                setPreviewIndex(index);
              });
            }}
          >
            {image.placeholder ? <View style={styles.imageAddingPlaceholder}><ActivityIndicator color={theme.colors.textMuted} /><Text style={styles.imageAddingText}>{t("card_detail.photo.adding")}</Text></View> : index === 0 ? <FocusedCoverImage image={image} frameWidth={pageWidth} /> : <Image
              source={{ uri: image.thumbnailUrl }}
              style={styles.carouselImageLayer}
              resizeMode="cover"
              fadeDuration={0}
              progressiveRenderingEnabled
            />}
            {image.status === "uploading" || image.status === "moderating" ? <View style={styles.draftImageOverlay}><ActivityIndicator color={theme.colors.surface} /></View> : null}
            {image.status === "failed" ? <View style={styles.draftImageOverlay}><Ionicons name="alert-circle-outline" size={24} color={theme.colors.surface} /></View> : null}
          </Pressable>
        )}
        getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={3}
        directionalLockEnabled
        nestedScrollEnabled
        bounces={false}
        decelerationRate="fast"
        snapToInterval={pageWidth}
        snapToAlignment="start"
        disableIntervalMomentum
        showsHorizontalScrollIndicator={false}
        style={styles.imageCarousel}
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.max(0, Math.min(displayImages.length - 1, Math.round(event.nativeEvent.contentOffset.x / pageWidth)));
          setImageIndex(nextIndex);
        }}
      />
      {displayImages.length > 1 ? (
        <View style={styles.imageDots}>
          {displayImages.map((image, index) => (
            <View key={`${image.key}:dot:${index}`} style={[styles.imageDot, index === imageIndex && styles.imageDotActive]} />
          ))}
        </View>
      ) : null}
      <CardImagePreview
        images={images}
        initialIndex={previewIndex ?? 0}
        visible={previewIndex !== null}
        origin={previewOrigin}
        dateLabel={dateLabel}
        onCoverPositionChange={onCoverPositionChange}
        onClose={() => { setPreviewIndex(null); setPreviewOrigin(null); }}
        onRemove={onRemove}
      />
    </View>
  );
});

function CardImagePreview({ images, initialIndex, visible, origin, dateLabel, onClose, onRemove, onCoverPositionChange }: {
  images: GalleryImage[];
  initialIndex: number;
  visible: boolean;
  origin: ImagePreviewOrigin | null;
  dateLabel?: string;
  onClose: () => void;
  onRemove?: (imageKey: string) => void;
  onCoverPositionChange?: (imageKey: string, focusX: number, focusY: number) => Promise<void>;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === "ios" ? 47 : 0);
  const bottomInset = Math.max(insets.bottom, Platform.OS === "ios" ? 20 : 0);
  const imageAreaHeight = Math.max(240, height - topInset - bottomInset - 58 - 76);
  const [index, setIndex] = useState(initialIndex);
  const [savingImage, setSavingImage] = useState(false);
  const listRef = useRef<FlatList<GalleryImage>>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const dismissOpacity = useRef(new Animated.Value(1)).current;
  const handoffOpacity = useRef(new Animated.Value(1)).current;
  const closingRef = useRef(false);
  const openingAnimationFinishedRef = useRef(false);
  const openingImageLoadedRef = useRef(false);
  const openingImage = images[initialIndex];
  const sourceWidth = openingImage?.width || width;
  const sourceHeight = openingImage?.height || imageAreaHeight;
  const naturalHeight = width * sourceHeight / sourceWidth;
  const targetHeight = Math.min(imageAreaHeight, naturalHeight);
  const targetWidth = naturalHeight <= imageAreaHeight ? width : imageAreaHeight * sourceWidth / sourceHeight;
  const targetX = (width - targetWidth) / 2;
  const targetY = topInset + 58;
  const startFrame = origin ?? { x: targetX, y: targetY, width: targetWidth, height: targetHeight };
  useEffect(() => {
    if (!visible) return;
    closingRef.current = false;
    progress.stopAnimation();
    progress.setValue(0);
    dismissOpacity.setValue(1);
    handoffOpacity.stopAnimation();
    handoffOpacity.setValue(1);
    openingAnimationFinishedRef.current = false;
    openingImageLoadedRef.current = false;
    setIndex(initialIndex);
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: initialIndex * width, animated: false }));
    Animated.timing(progress, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (!finished) return;
      openingAnimationFinishedRef.current = true;
      if (openingImageLoadedRef.current) {
        Animated.timing(handoffOpacity, { toValue: 0, duration: 100, useNativeDriver: false }).start();
      }
    });
  }, [dismissOpacity, handoffOpacity, initialIndex, progress, visible, width]);
  function close(afterClose?: () => void): void {
    if (closingRef.current) return;
    closingRef.current = true;
    const canShrinkToOrigin = Boolean(origin) && index === initialIndex;
    if (canShrinkToOrigin) handoffOpacity.setValue(1);
    const animation = canShrinkToOrigin
      ? Animated.timing(progress, { toValue: 0, duration: 240, easing: Easing.inOut(Easing.cubic), useNativeDriver: false })
      : Animated.timing(dismissOpacity, { toValue: 0, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start(() => {
      closingRef.current = false;
      onClose();
      afterClose?.();
    });
  }
  async function saveCurrentImage(): Promise<void> {
    const image = images[index];
    if (!image || savingImage) return;
    setSavingImage(true);
    let downloadedUri: string | null = null;
    try {
      if (Platform.OS === "android") {
        const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
        if (!permission.granted) {
          Alert.alert(t("card_detail.photo.save_permission_title"), t("card_detail.photo.save_permission_message"));
          return;
        }
      }
      const extension = image.url.match(/\.(png|jpe?g)(?:\?|$)/i)?.[1]?.toLowerCase().replace("jpeg", "jpg") || "jpg";
      const destination = new File(Paths.cache, `oio-card-${image.key}.${extension}`);
      // Expo 54 exposes the native base File type in this static method's
      // declaration even though it accepts the public File wrapper at runtime.
      const downloadFile = File.downloadFileAsync as unknown as (
        url: string,
        target: File,
        options: { idempotent: boolean },
      ) => Promise<{ uri: string }>;
      const downloaded = await downloadFile(image.url, destination, { idempotent: true });
      downloadedUri = downloaded.uri;
      await MediaLibrary.saveToLibraryAsync(downloadedUri);
      Alert.alert(t("card_detail.photo.save_success_title"), t("card_detail.photo.save_success_message"));
    } catch {
      Alert.alert(t("card_detail.photo.save_failed_title"), t("card_detail.photo.save_failed_message"));
    } finally {
      try {
        if (downloadedUri) {
          const cachedFile = new File(downloadedUri);
          if (cachedFile.exists) cachedFile.delete();
        }
      } catch { /* cache cleanup is best effort */ }
      setSavingImage(false);
    }
  }
  const chromeOpacity = progress.interpolate({ inputRange: [0, 0.82, 1], outputRange: [0, 0, 1] });
  const fullImageOpacity = progress.interpolate({ inputRange: [0, 0.9, 1], outputRange: [0, 0, 1] });
  return <Modal visible={visible} transparent animationType="none" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => close()}>
    <Animated.View style={[styles.imagePreviewPage, { paddingTop: topInset, paddingBottom: bottomInset, opacity: dismissOpacity }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.imagePreviewBackdrop, { opacity: progress }]} />
      <Animated.View
        style={[styles.imagePreviewHeader, { opacity: chromeOpacity }]}
      >
        <View style={styles.imagePreviewHeaderStart}><Pressable accessibilityLabel={t("card_detail.a11y.back_from_image_preview")} hitSlop={10} style={styles.imagePreviewHeaderButton} onPress={() => close()}><Ionicons name="arrow-back" size={27} color={theme.colors.text} /></Pressable></View>
        <Text style={styles.imagePreviewCounter}>{images.length > 1 ? `${index + 1} / ${images.length}` : ""}</Text>
        <View style={styles.imagePreviewHeaderEnd}>
          <Pressable accessibilityLabel={t("card_detail.a11y.save_image")} disabled={savingImage} hitSlop={10} style={styles.imagePreviewHeaderButton} onPress={() => void saveCurrentImage()}>{savingImage ? <ActivityIndicator size="small" color={theme.colors.text} /> : <Ionicons name="download-outline" size={25} color={theme.colors.text} />}</Pressable>
          {onRemove && images[index] ? <Pressable accessibilityLabel={t("common.delete")} hitSlop={10} style={styles.imagePreviewHeaderButton} onPress={() => close(() => onRemove(images[index]!.key))}><Ionicons name="trash-outline" size={25} color={theme.colors.danger} /></Pressable> : null}
        </View>
      </Animated.View>
      <Animated.View style={{ height: imageAreaHeight, opacity: fullImageOpacity }}><FlatList
        ref={listRef}
        horizontal
        pagingEnabled
        data={images}
        keyExtractor={(image) => image.key}
        renderItem={({ item }) => {
          const naturalHeight = item.width && item.height ? width * item.height / item.width : imageAreaHeight;
          return <View style={[styles.imagePreviewPageItem, { width, height: imageAreaHeight }]}><Image
            source={{ uri: item.url }}
            resizeMode="contain"
            style={[styles.imagePreviewImage, { width, height: Math.min(imageAreaHeight, naturalHeight) }]}
            onLoad={item.key === openingImage?.key ? () => {
              openingImageLoadedRef.current = true;
              if (openingAnimationFinishedRef.current) {
                Animated.timing(handoffOpacity, { toValue: 0, duration: 100, useNativeDriver: false }).start();
              }
            } : undefined}
          /></View>;
        }}
        getItemLayout={(_, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })}
        initialScrollIndex={Math.min(initialIndex, Math.max(images.length - 1, 0))}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.max(0, Math.min(images.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)));
          setIndex(nextIndex);
          if (nextIndex !== initialIndex) handoffOpacity.setValue(0);
        }}
      />{index === 0 && images[0] && onCoverPositionChange ? <PreviewCoverCropOverlay image={images[0]} width={width} height={imageAreaHeight} onCommit={(focusY) => onCoverPositionChange(images[0]!.key, images[0]!.focusX ?? 0.5, focusY)} /> : null}</Animated.View>
      <Animated.View style={[styles.imagePreviewFooter, { opacity: chromeOpacity }]}><Text style={styles.imagePreviewDate}>{dateLabel ?? ""}</Text></Animated.View>
      {openingImage ? <Animated.View
        pointerEvents="none"
        style={[
          styles.imagePreviewTransitionImage,
          {
            opacity: handoffOpacity,
            left: progress.interpolate({ inputRange: [0, 1], outputRange: [startFrame.x, targetX] }),
            top: progress.interpolate({ inputRange: [0, 1], outputRange: [startFrame.y, targetY] }),
            width: progress.interpolate({ inputRange: [0, 1], outputRange: [startFrame.width, targetWidth] }),
            height: progress.interpolate({ inputRange: [0, 1], outputRange: [startFrame.height, targetHeight] }),
            borderRadius: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
          },
        ]}
      ><Image source={{ uri: openingImage.thumbnailUrl }} resizeMode="cover" style={styles.imagePreviewTransitionFill} /></Animated.View> : null}
    </Animated.View>
  </Modal>;
}

function detailGalleryImages(images: NonNullable<CardRecordDetail["images"]>, legacyThumbnailUrl?: string): GalleryImage[] {
  return images.map((image, index) => ({
    key: image.id,
    url: image.url,
    thumbnailUrl: image.thumbnail?.url || (index === 0 ? legacyThumbnailUrl : undefined) || image.url,
    width: image.width,
    height: image.height,
    focusX: image.focusX,
    focusY: image.focusY,
  }));
}

function Review({ detail, imageAdding, contentBinding, practiceEnabled, canUseDictation, autoStartClozePractice, clozeState, clozeVersion, onClozeChange, onRemoveImage, onCoverPositionChange, relations, onOpenRelated, onOpenDictation, pendingGenerationTargets = [], failedGenerationTargets = [], retryingGenerationTarget = null, onRetryGeneration, onRecallFinish, onClozeAttempt, onPendingClozeCheckHandlerChange, onInteractionLockChange, focusLearningContent = false, onLearningTargetReady, focusActionBar = false, onActionBarTargetReady }: {
  detail: CardRecordDetail;
  imageAdding: boolean;
  contentBinding: CardContentBinding;
  practiceEnabled: boolean;
  canUseDictation: boolean;
  autoStartClozePractice: boolean;
  clozeState: CardClozeState;
  clozeVersion: number;
  onClozeChange: (state: CardClozeState, version: number) => void;
  onRemoveImage?: (imageId?: string) => void;
  onCoverPositionChange?: (imageId: string, focusX: number, focusY: number) => Promise<void>;
  relations: Array<{ recordId: string; topic: string | null; card: CardRelationPreview | null; reasons: CardRelationReason[] }>;
  onOpenRelated?: (recordId: string, reasons: CardRelationReason[]) => void;
  onOpenDictation: () => void;
  pendingGenerationTargets?: CardGenerationTarget[];
  failedGenerationTargets?: CardGenerationTarget[];
  retryingGenerationTarget?: CardGenerationTarget | null;
  onRetryGeneration?: (target: CardGenerationTarget) => void;
  onRecallFinish?: () => void;
  onClozeAttempt?: (input: { recordId: string; blankId: string; correct: boolean }) => void;
  onPendingClozeCheckHandlerChange?: (handler: PendingClozeCheckHandler | null) => void;
  onInteractionLockChange?: (locked: boolean) => void;
  focusLearningContent?: boolean;
  onLearningTargetReady?: (target: ClozeOnboardingTarget) => void;
  focusActionBar?: boolean;
  onActionBarTargetReady?: (target: ClozeOnboardingTarget) => void;
}) {
  const { width: reviewWindowWidth, height: reviewWindowHeight } = useWindowDimensions();
  const learningTargetRef = useRef<View>(null);
  const learningTargetContentYRef = useRef(0);
  const flipCardScrollRef = useRef<React.ComponentRef<typeof KeyboardAwareScrollView>>(null);
  const actionBarRef = useRef<View>(null);
  const images = useMemo(
    () => detail.images?.length ? detail.images : detail.image ? [detail.image] : [],
    [detail.images, detail.image],
  );
  const blankCount = clozeState.blanks.length;
  const [savingCloze, setSavingCloze] = useState(false);
  const [clozeMode, setClozeMode] = useState<ClozeInteractionMode>(() => initialClozeInteractionMode(autoStartClozePractice, blankCount));
  const fillMode = clozeMode !== "edit";
  const clozeInputMode: ClozeInputMode = clozeMode === "choice" ? "choice" : "keyboard";
  const [choiceTrayOptions, setChoiceTrayOptions] = useState<ClozeChoiceOption[]>([]);
  const choiceAnswerHandlerRef = useRef<(value: string) => void>(() => undefined);
  const [blankAction, setBlankAction] = useState<{ blank: CardClozeState["blanks"][number]; anchor: CardBlankActionAnchor } | null>(null);
  const [cardFace, setCardFace] = useState<"front" | "back">("front");
  const flipProgress = useRef(new Animated.Value(0)).current;
  const flipAnimatingRef = useRef(false);
  const [answersVisible, setAnswersVisible] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<"learning" | "reply" | "original" | "translation", boolean>>({ learning: false, reply: false, original: false, translation: false });
  const [articleAudioLoading, setArticleAudioLoading] = useState(false);
  const [sentenceAudioLoadingKey, setSentenceAudioLoadingKey] = useState<string | null>(null);
  const { showNotice } = useFloatingNotice();
  const clozeSavingNoticeRef = useRef<ReturnType<typeof showNotice> | null>(null);
  const articleAudioPromisesRef = useRef(new Map<string, Promise<string>>());
  const wholeArticleAudioPromisesRef = useRef(new Map<string, Promise<{
    audioUrl: string;
    sentenceMarks: Array<{ text: string; textStart: number; textEnd: number; startMs: number; durationMs: number }>;
    deliveryMode: "buffered" | "streaming";
  }>>());
  const [articleSentenceMarks, setArticleSentenceMarks] = useState<Array<{
    text: string;
    textStart: number;
    textEnd: number;
    startMs: number;
    durationMs: number;
  }>>([]);
  const toggleSection = (section: keyof typeof collapsedSections) => setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  const playback = React.useSyncExternalStore(subscribeTtsPlayback, getTtsPlaybackState, getTtsPlaybackState);
  const articleNavigationPrefix = `card:${detail.id}:article:`;
  const sentenceNavigationPrefix = `card:${detail.id}:sentence:`;
  const replyNavigationPrefix = `card:${detail.id}:reply:`;
  const articleReplyNavigationPrefix = `card:${detail.id}:article-reply:`;
  const articlePlaybackActive = Boolean(
    playback.hasActiveAudio
    && (playback.activeNavigationKey?.startsWith(articleNavigationPrefix)
      || playback.activeNavigationKey?.startsWith(articleReplyNavigationPrefix)),
  );
  const articlePlaybackLoading = articleAudioLoading || (articlePlaybackActive && playback.status === "loading");
  const articlePlaying = articlePlaybackActive && playback.status === "playing";
  const hasBlanks = clozeState.blanks.length > 0;
  const articleRows = useMemo(() => buildCardClozeSentenceRows(detail, clozeState, true), [detail, clozeState]);
  const replyBlock = detail.contentBlocks.find((candidate) => candidate.contentType === "reply");
  const expressionPending = pendingGenerationTargets.includes("expression");
  const expressionFailed = failedGenerationTargets.includes("expression");
  const rewriteIsPrimary = contentBinding.contentType === "rewrite" || expressionPending || expressionFailed;
  const rewriteIsReady = contentBinding.contentType === "rewrite";
  const frontLearningReady = rewriteIsReady || !rewriteIsPrimary;
  const learningText = detail.contentBlocks.find((candidate) =>
    candidate.contentType === contentBinding.contentType
    && candidate.contentVersion === contentBinding.contentVersion,
  )?.text ?? (contentBinding.contentType === "original" ? detail.originalText : detail.rewrittenText || detail.originalText);
  const activeArticleMarkIndex = (() => {
    if (!articlePlaybackActive || !playback.activeNavigationKey?.startsWith(articleNavigationPrefix) || !articleSentenceMarks.length) return null;
    let activeIndex = 0;
    for (let index = 1; index < articleSentenceMarks.length; index += 1) {
      if (playback.positionMs < articleSentenceMarks[index]!.startMs) break;
      activeIndex = index;
    }
    return activeIndex;
  })();
  const replyPlaybackActive = Boolean(
    playback.hasActiveAudio
    && (playback.activeNavigationKey?.startsWith(replyNavigationPrefix)
      || playback.activeNavigationKey?.startsWith(articleReplyNavigationPrefix)
      || (activeArticleMarkIndex !== null && activeArticleMarkIndex >= articleRows.length)),
  );
  const replyPlaybackLoading = replyPlaybackActive && playback.status === "loading";
  const replyPlaying = replyPlaybackActive && playback.status === "playing";
  const activeSentenceKey = (() => {
    if (!playback.hasActiveAudio || !playback.activeNavigationKey) return null;
    if (playback.activeNavigationKey.startsWith(sentenceNavigationPrefix)) {
      return playback.activeNavigationKey.slice(sentenceNavigationPrefix.length);
    }
    if (playback.activeNavigationKey.startsWith(articleNavigationPrefix)) {
      const index = activeArticleMarkIndex ?? Number(playback.activeNavigationKey.slice(articleNavigationPrefix.length));
      return Number.isInteger(index) ? articleRows[index]?.key ?? null : null;
    }
    return null;
  })();
  const [dictionary, setDictionary] = useState<DictionaryLookupState | null>(null);
  const dictionaryRequestRef = useRef(0);
  const [textSelectionActive, setTextSelectionActive] = useState(false);
  useEffect(() => {
    if (!focusLearningContent || !onLearningTargetReady) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = (allowScroll: boolean) => {
      learningTargetRef.current?.measureInWindow((x, y, width, height) => {
        if (cancelled || width <= 0 || height <= 0) return;
        const needsScroll = allowScroll && (y < 82 || y + height > reviewWindowHeight - 235);
        if (needsScroll) {
          flipCardScrollRef.current?.scrollTo({ y: Math.max(0, learningTargetContentYRef.current - 68), animated: true });
          timer = setTimeout(() => measure(false), 360);
          return;
        }
        onLearningTargetReady({ x, y, width, height });
      });
    };
    const frame = requestAnimationFrame(() => measure(true));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [focusLearningContent, onLearningTargetReady, reviewWindowHeight]);
  useEffect(() => {
    if (!focusActionBar || !onActionBarTargetReady) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      actionBarRef.current?.measureInWindow((x, y, width, height) => {
        if (!cancelled && width > 0 && height > 0) onActionBarTargetReady({ x, y, width, height });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [focusActionBar, onActionBarTargetReady]);
  const lockForTextSelection = useCallback(() => setTextSelectionActive(true), []);
  const unlockTextSelection = useCallback(() => setTextSelectionActive(false), []);
  useEffect(() => {
    onInteractionLockChange?.(savingCloze || Boolean(dictionary) || Boolean(blankAction) || textSelectionActive);
  }, [blankAction, dictionary, onInteractionLockChange, savingCloze, textSelectionActive]);
  useEffect(() => () => {
    onInteractionLockChange?.(false);
  }, [onInteractionLockChange]);
  const updateChoiceTrayOptions = useCallback((next: ClozeChoiceOption[]) => {
    setChoiceTrayOptions((current) => {
      if (current.length === next.length && current.every((option, index) => option.value === next[index]?.value && option.incorrect === next[index]?.incorrect)) {
        return current;
      }
      return next;
    });
  }, []);
  const registerChoiceAnswerHandler = useCallback((handler: ((value: string) => void) | null) => {
    choiceAnswerHandlerRef.current = handler ?? (() => undefined);
  }, []);
  useLayoutEffect(() => {
    setClozeMode(initialClozeInteractionMode(autoStartClozePractice, clozeState.blanks.length));
    setChoiceTrayOptions([]);
    setAnswersVisible(false);
    setArticleSentenceMarks([]);
    setSentenceAudioLoadingKey(null);
    setCardFace("front");
    flipProgress.stopAnimation();
    flipProgress.setValue(0);
    flipAnimatingRef.current = false;
  }, [detail.id, contentBinding.contentType, contentBinding.contentVersion, autoStartClozePractice, flipProgress]);
  useEffect(() => {
    // Keep an active practice mode valid when the server state changes, but never
    // auto-enter practice after the user exits it or creates a blank in edit mode.
    setClozeMode((current) => {
      if (blankCount === 0) return "edit";
      if (current === "choice" && blankCount < 2) return "keyboard";
      return current;
    });
  }, [blankCount]);
  useEffect(() => {
    if (savingCloze) {
      clozeSavingNoticeRef.current ??= showNotice({
        message: t("card_detail.cloze.saving"),
        type: "info",
        position: "top-center",
        durationMs: 0,
      });
      return;
    }
    clozeSavingNoticeRef.current?.hide();
    clozeSavingNoticeRef.current = null;
  }, [savingCloze, showNotice]);
  useEffect(() => () => {
    clozeSavingNoticeRef.current?.hide();
    clozeSavingNoticeRef.current = null;
  }, []);

  function flipCard(): void {
    if (flipAnimatingRef.current) return;
    flipAnimatingRef.current = true;
    const nextFace = cardFace === "front" ? "back" : "front";
    Keyboard.dismiss();
    Animated.timing(flipProgress, {
      toValue: 1,
      duration: 150,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        flipProgress.setValue(0);
        flipAnimatingRef.current = false;
        return;
      }
      setCardFace(nextFace);
      requestAnimationFrame(() => {
        Animated.timing(flipProgress, {
          toValue: 0,
          duration: 170,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => { flipAnimatingRef.current = false; });
      });
    });
  }

  function toggleClozeMode(mode: ClozeInputMode): void {
    if (clozeMode === mode) {
      setClozeMode("edit");
      setAnswersVisible(false);
      return;
    }
    if (mode === "choice" && blankCount < 2) {
      showNotice({ message: t("card_detail.cloze.choice_unavailable"), type: "info", position: "top-center" });
      return;
    }
    if (blankCount === 0) return;
    setClozeMode(mode);
    setAnswersVisible(false);
  }

  async function copySection(text: string): Promise<void> {
    if (!text.trim()) return;
    try {
      const copied = await copyTextToClipboard(text);
      if (copied) showNotice({ message: t("common.copy.success"), type: "success", position: "top-center", durationMs: 1200 });
    } catch {
      Alert.alert(t("card_detail.copy_failed"));
    }
  }
  async function addBlank(segment: CardRecordDetail["rewriteSegments"][number], payload: NativeTextSelectionPayload): Promise<void> {
    if (savingCloze || clozeMode !== "edit") return;
    if (
      payload.start < 0
      || payload.end > segment.text.length
      || payload.start >= payload.end
      || segment.text.slice(payload.start, payload.end).normalize("NFC") !== payload.selectedText.normalize("NFC")
    ) return;
    const expanded = expandSelectionToCardBlankRange(segment.text, payload.start, payload.end);
    if (!expanded || !segment.text.slice(expanded.start, expanded.end).trim()) return;
    const { start, end } = expanded;
    const overlaps = clozeState.blanks.some((blank) => blank.segmentId === segment.id && blank.startUtf16 < end && blank.endUtf16 > start);
    if (overlaps) {
      showNotice({ message: t("card_detail.cloze.already_set"), type: "info", position: "top-center" });
      return;
    }
    setSavingCloze(true);
    try {
      const practice = await saveCardClozeUpdate(detail.id, {
        ...contentBinding,
        baseVersion: clozeVersion,
        operation: { type: "add", segmentId: segment.id, startUtf16: start, endUtf16: end },
      });
      onClozeChange(asCardClozeState(practice.clozeState), practice.clozeVersion);
    } catch (error) {
      if (error instanceof CardApiError && error.code === "CARD_PRACTICE_CONFLICT") {
        try {
          const latest = await getCardRecord(detail.id);
          const latestPractice = contentPractice(latest, contentBinding);
          const latestState = asCardClozeState(latestPractice?.clozeState);
          const latestVersion = latestPractice?.clozeVersion ?? 0;
          const alreadySaved = latestState.blanks.some((blank) =>
            blank.segmentId === segment.id
            && blank.startUtf16 === start
            && blank.endUtf16 === end,
          );
          if (alreadySaved) {
            onClozeChange(latestState, latestVersion);
            return;
          }
          const practice = await saveCardClozeUpdate(detail.id, {
            ...contentBinding,
            baseVersion: latestVersion,
            operation: { type: "add", segmentId: segment.id, startUtf16: start, endUtf16: end },
          });
          onClozeChange(asCardClozeState(practice.clozeState), practice.clozeVersion);
          return;
        } catch (retryError) {
          showNotice({ message: retryError instanceof Error ? retryError.message : t("card_detail.cloze.save_failed"), type: "error", position: "top-center" });
          return;
        }
      }
      showNotice({ message: error instanceof Error ? error.message : t("card_detail.cloze.save_failed"), type: "error", position: "top-center" });
    } finally {
      setSavingCloze(false);
    }
  }

  function prepareReplyAudio(index: number, options: { waitForDownload?: boolean } = {}): Promise<string> {
    const block = detail.contentBlocks.find((candidate) => candidate.contentType === "reply");
    const segment = block?.segments[index];
    if (!block || !segment) return Promise.reject(new Error("Reply sentence is unavailable"));
    const requestKey = ["card-reply", detail.id.slice("card:".length), segment.id, block.contentVersion].join("-");
    const existing = articleAudioPromisesRef.current.get(requestKey);
    if (existing) return existing;
    const request = (async () => {
      const audio = await getCardSegmentAudio({
        entryId: detail.id.slice("card:".length),
        segmentId: segment.id,
        sourceKind: "review_segment",
        contentType: block.contentType,
        contentVersion: block.contentVersion,
      });
      const source = { url: audio.audioUrl, cacheKey: [requestKey, audio.provider, audio.voiceCode].join("-") };
      if (options.waitForDownload) return preloadTtsAudio(source);
      void preloadTtsAudio(source).catch(() => undefined);
      return audio.audioUrl;
    })();
    articleAudioPromisesRef.current.set(requestKey, request);
    void request.finally(() => {
      if (articleAudioPromisesRef.current.get(requestKey) === request) articleAudioPromisesRef.current.delete(requestKey);
    }).catch(() => undefined);
    return request;
  }

  async function playReplyFrom(index: number, onComplete?: () => void, partOfArticle = false, sessionId = beginTtsPlaybackSession()): Promise<void> {
    const block = detail.contentBlocks.find((candidate) => candidate.contentType === "reply");
    const segment = block?.segments[index];
    if (!block || !segment) {
      onComplete?.();
      return;
    }
    try {
      const audioUrl = await prepareReplyAudio(index);
      if (!isTtsPlaybackSessionCurrent(sessionId)) return;
      if (index + 1 < block.segments.length) {
        void prepareReplyAudio(index + 1, { waitForDownload: true }).catch(() => undefined);
      }
      await playTtsAudio({
        url: audioUrl,
        loopScope: "all",
        navigationKey: `${partOfArticle ? articleReplyNavigationPrefix : replyNavigationPrefix}${index}`,
        sessionId,
        onFinished: () => {
          const nextIndex = index + 1;
          if (nextIndex < block.segments.length) void playReplyFrom(nextIndex, onComplete, partOfArticle, sessionId);
          else onComplete?.();
        },
      });
    } catch (error) {
      Alert.alert(t("card_detail.error.play"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
    }
  }

  function playReply(): void {
    if (replyPlaybackActive) {
      toggleTtsPlayback();
      return;
    }
    void playReplyFrom(0);
  }

  function prepareWholeArticleAudio(): Promise<{
    audioUrl: string;
    sentenceMarks: Array<{ text: string; textStart: number; textEnd: number; startMs: number; durationMs: number }>;
    deliveryMode: "buffered" | "streaming";
  }> {
    if (detail.source !== "card") return Promise.reject(new Error("Article is unavailable"));
    const entryId = detail.id.slice("card:".length);
    const requestKey = ["card-article-whole", entryId, contentBinding.contentType, contentBinding.contentVersion].join("-");
    const existing = wholeArticleAudioPromisesRef.current.get(requestKey);
    if (existing) return existing;
    const request = (async () => {
      const audio = await getCardArticleAudio({ entryId, ...contentBinding });
      const deliveryMode = audio.deliveryMode ?? "buffered";
      if (deliveryMode === "buffered") {
        const source = { url: audio.audioUrl, cacheKey: [requestKey, audio.provider, audio.voiceCode].join("-") };
        void preloadTtsAudio(source).catch(() => undefined);
      }
      return { audioUrl: audio.audioUrl, sentenceMarks: audio.sentenceMarks ?? [], deliveryMode };
    })();
    wholeArticleAudioPromisesRef.current.set(requestKey, request);
    void request.then((audio) => {
      if (audio.deliveryMode === "streaming" && wholeArticleAudioPromisesRef.current.get(requestKey) === request) {
        wholeArticleAudioPromisesRef.current.delete(requestKey);
      }
    });
    void request.catch(() => {
      if (wholeArticleAudioPromisesRef.current.get(requestKey) === request) wholeArticleAudioPromisesRef.current.delete(requestKey);
    });
    return request;
  }

  async function playArticle(): Promise<void> {
    if (articleAudioLoading || detail.source !== "card") return;
    const rows = articleRows;
    if (!rows.length) return;
    setArticleAudioLoading(true);
    const sessionId = beginTtsPlaybackSession();
    try {
      const audio = await prepareWholeArticleAudio();
      if (!isTtsPlaybackSessionCurrent(sessionId)) return;
      setArticleSentenceMarks(audio.sentenceMarks);
      await playTtsAudio({
        url: audio.audioUrl,
        loopScope: "all",
        navigationKey: `${articleNavigationPrefix}0`,
        sessionId,
        loadTimeoutMs: audio.deliveryMode === "streaming" ? 45_000 : undefined,
        onFinished: () => {
          if (getTtsPlaybackState().loopMode === "all") void playArticle();
        },
      });
    } catch (error) {
      setArticleSentenceMarks([]);
      showNotice({ message: error instanceof Error ? error.message : t("card_detail.error.play"), type: "error", position: "top-center" });
    } finally {
      setArticleAudioLoading(false);
    }
  }

  async function playStandaloneSentence(row: CardClozeSentenceRow): Promise<void> {
    if (detail.source !== "card") return;
    const sessionId = beginTtsPlaybackSession();
    setSentenceAudioLoadingKey(row.key);
    try {
      const audio = await getCardSegmentAudio({
        entryId: detail.id.slice("card:".length),
        segmentId: row.segmentId,
        sourceKind: "review_segment",
        ...contentBinding,
      });
      if (!isTtsPlaybackSessionCurrent(sessionId)) return;
      await playTtsAudio({
        url: audio.audioUrl,
        cacheKey: ["card-segment", detail.id, row.segmentId, contentBinding.contentVersion, audio.provider, audio.voiceCode].join("-"),
        loopScope: "one",
        navigationKey: `card:${detail.id}:sentence:${row.key}`,
        sessionId,
      });
    } catch (error) {
      showNotice({ message: error instanceof Error ? error.message : t("card_detail.error.play"), type: "error", position: "top-center" });
    } finally {
      setSentenceAudioLoadingKey((current) => current === row.key ? null : current);
    }
  }

  useEffect(() => {
    const key = playback.activeNavigationKey;
    if (!playback.hasActiveAudio || !key) {
      setTtsNavigationControls(null);
      return;
    }
    let queueIndex = -1;
    if (key.startsWith(articleNavigationPrefix)) {
      queueIndex = activeArticleMarkIndex ?? Number(key.slice(articleNavigationPrefix.length));
    } else if (key.startsWith(sentenceNavigationPrefix)) {
      const sentenceKey = key.slice(sentenceNavigationPrefix.length);
      queueIndex = articleRows.findIndex((row) => row.key === sentenceKey);
    } else if (key.startsWith(articleReplyNavigationPrefix) || key.startsWith(replyNavigationPrefix)) {
      const prefix = key.startsWith(articleReplyNavigationPrefix) ? articleReplyNavigationPrefix : replyNavigationPrefix;
      const replyIndex = Number(key.slice(prefix.length));
      if (Number.isInteger(replyIndex)) queueIndex = articleRows.length + replyIndex;
    } else {
      return;
    }
    const queueLength = articleRows.length + (replyBlock?.segments.length ?? 0);
    if (!Number.isInteger(queueIndex) || queueIndex < 0 || queueIndex >= queueLength) {
      setTtsNavigationControls(null);
      return;
    }
    const wraps = playback.loopMode === "all" && queueLength > 1;
    const playQueueIndex = (nextQueueIndex: number) => {
      const normalized = (nextQueueIndex + queueLength) % queueLength;
      if (normalized < articleRows.length) {
        void playStandaloneSentence(articleRows[normalized]!);
      } else {
        void playReplyFrom(normalized - articleRows.length, () => {
          if (getTtsPlaybackState().loopMode === "all" && articleRows[0]) void playStandaloneSentence(articleRows[0]);
        }, true);
      }
    };
    setTtsNavigationControls({
      canNavigatePrevious: queueIndex > 0 || wraps,
      canNavigateNext: queueIndex < queueLength - 1 || wraps,
      onNavigatePrevious: () => playQueueIndex(queueIndex - 1),
      onNavigateNext: () => playQueueIndex(queueIndex + 1),
    });
    return () => setTtsNavigationControls(null);
  }, [
    articleNavigationPrefix,
    articleReplyNavigationPrefix,
    articleRows,
    activeArticleMarkIndex,
    playback.activeNavigationKey,
    playback.hasActiveAudio,
    playback.loopMode,
    replyBlock?.segments.length,
    replyNavigationPrefix,
    sentenceNavigationPrefix,
  ]);

  async function removeBlank(blank: CardClozeState["blanks"][number]): Promise<void> {
    if (savingCloze) return;
    setSavingCloze(true);
    try {
      const practice = await saveCardClozeUpdate(detail.id, {
        ...contentBinding,
        baseVersion: clozeVersion,
        operation: { type: "remove", blankId: blank.id },
      });
      onClozeChange(asCardClozeState(practice.clozeState), practice.clozeVersion);
    } catch (error) {
      if (error instanceof CardApiError && error.code === "CARD_PRACTICE_CONFLICT") {
        try {
          const latest = await getCardRecord(detail.id);
          const latestPractice = contentPractice(latest, contentBinding);
          const latestState = asCardClozeState(latestPractice?.clozeState);
          const latestVersion = latestPractice?.clozeVersion ?? 0;
          if (!latestState.blanks.some((candidate) => candidate.id === blank.id)) {
            onClozeChange(latestState, latestVersion);
            return;
          }
          const practice = await saveCardClozeUpdate(detail.id, {
            ...contentBinding,
            baseVersion: latestVersion,
            operation: { type: "remove", blankId: blank.id },
          });
          onClozeChange(asCardClozeState(practice.clozeState), practice.clozeVersion);
          return;
        } catch (retryError) {
          showNotice({ message: retryError instanceof Error ? retryError.message : t("card_detail.cloze.delete_failed"), type: "error", position: "top-center" });
          return;
        }
      }
      showNotice({ message: error instanceof Error ? error.message : t("card_detail.cloze.delete_failed"), type: "error", position: "top-center" });
    } finally {
      setSavingCloze(false);
    }
  }

  function lookup(segment: CardRecordDetail["rewriteSegments"][number], payload: NativeTextSelectionPayload): void {
    lookupText(segment.text, payload, segment.id);
  }

  function lookupText(context: string, payload: NativeTextSelectionPayload, segmentId = ""): void {
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
      segmentId,
      start: payload.start,
      end: payload.end,
    });
    void lookupDictionary({
      term,
      context,
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
      setDictionary((current) => current ? { ...current, loading: false, error: t(dictionaryLookupErrorKey(error)) } : null);
    });
  }

  function openBlankActions(blank: CardClozeState["blanks"][number], anchor?: CardBlankActionAnchor): void {
    setBlankAction({
      blank,
      anchor: anchor ?? { pageX: reviewWindowWidth / 2 - 1, pageY: 230, width: 2, height: 24 },
    });
  }

  function lookupBlankAction(): void {
    if (!blankAction) return;
    const { blank } = blankAction;
    const segment = detail.rewriteSegments.find((candidate) => candidate.id === blank.segmentId);
    if (!segment) return;
    const payload = {
      start: blank.startUtf16,
      end: blank.endUtf16,
      selectedText: segment.text.slice(blank.startUtf16, blank.endUtf16),
    };
    setBlankAction(null);
    lookup(segment, payload);
  }

  const flipCardTransformStyle = {
    transform: [
      { scaleX: flipProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.025] }) },
      { scaleY: flipProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] }) },
    ],
  };
  const relatedContent = relations.length ? (
    <View style={styles.relationsSection}>
      <View style={styles.relationsHeader}>
        <Text style={styles.relationsSectionTitle}>{t("card_detail.related_records")}</Text>
      </View>
      {relations.map((relation) => {
        const isGrowth = relation.reasons.some((reason) => reason.type === "progress" && reason.isFirstUserProduced);
        const visibleReasons = relation.reasons.filter((reason) => reason.type !== "progress").slice(0, 2);
        return <Pressable key={relation.recordId} style={[styles.relationRow, isGrowth && styles.relationRowGrowth]} onPress={() => onOpenRelated?.(relation.recordId, relation.reasons)}>
          {relation.card?.thumbnail ? <Image source={{ uri: relation.card.thumbnail.url }} resizeMode="cover" style={styles.relationThumbnail} /> : null}
          <View style={styles.relationContent}>
            {isGrowth ? <Text style={styles.growthMomentLabel}>{t("card_detail.growth_moment")}</Text> : null}
            <Text numberOfLines={1} style={styles.relationCardTitle}>{relation.card?.displayTitle || relation.topic || t("card_detail.another_record")}</Text>
            <Text style={styles.relationDate}>{relation.card ? formatDate(relation.card.dateKey) : t("card_detail.past_record")}</Text>
            <RelationFocusText relation={relation} currentOriginalText={detail.originalText} />
            {visibleReasons.length ? <View style={styles.relationReasons}>{visibleReasons.map((reason, index) => <ReasonBadge key={`${reason.type}:${index}`} reason={reason} />)}</View> : null}
          </View>
          <Ionicons name="chevron-forward" size={17} color={theme.colors.textMuted} />
        </Pressable>;
      })}
    </View>
  ) : null;

  return (
    <View style={styles.reviewPage}>
    <View style={styles.flipCardStage}>
      <Animated.View style={[styles.flipCardShell, flipCardTransformStyle]}>
      <View pointerEvents={cardFace === "front" ? "auto" : "none"} style={[styles.flipCardFace, cardFace !== "front" && styles.flipCardFaceHidden]}>
        <KeyboardAwareScrollView ref={flipCardScrollRef} style={styles.flipCardScroll} bottomOffset={16} extraKeyboardSpace={12} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.flipCardContent} alwaysBounceVertical={false}>
          <View style={styles.cardTitleRow}>
            <Text numberOfLines={2} style={[styles.cardDisplayTitle, styles.cardDisplayTitleInRow]}>{detail.displayTitle}</Text>
          </View>
          <Text style={styles.date}>{formatDate(detail.dateKey)} · {formatTime(detail.createdAt)}</Text>
          <CardImageGallery images={detailGalleryImages(images, detail.thumbnail?.url)} loading={imageAdding} dateLabel={`${formatDate(detail.dateKey)} · ${formatTime(detail.createdAt)}`} onRemove={onRemoveImage} onCoverPositionChange={onCoverPositionChange} />
          <View ref={learningTargetRef} style={styles.flipCardTextBlock} onLayout={(event) => { learningTargetContentYRef.current = event.nativeEvent.layout.y; }}>
            {frontLearningReady ? <CollapsibleCardSection label={rewriteIsReady ? t("card_detail.module.expression_description") : t("card_detail.my_record")} collapsed={collapsedSections.learning} onToggle={() => toggleSection("learning")} compact>
                {practiceEnabled
                  ? <Cloze embedded detail={detail} contentBinding={contentBinding} clozeState={clozeState} clozeVersion={clozeVersion} onClozeChange={onClozeChange} onAddBlank={(segment, payload) => void addBlank(segment, payload)} onBlankLongPress={openBlankActions} onPlaySentence={(row) => void playStandaloneSentence(row)} fillMode={fillMode} inputMode={clozeInputMode} answersVisible={answersVisible} activeSentenceKey={activeSentenceKey} loadingSentenceKey={sentenceAudioLoadingKey} onChoiceOptionsChange={updateChoiceTrayOptions} onChoiceAnswerHandlerChange={registerChoiceAnswerHandler} onPendingClozeCheckHandlerChange={onPendingClozeCheckHandlerChange} onClozeAttempt={onClozeAttempt} onTextSelectionStart={lockForTextSelection} onTextSelectionEnd={unlockTextSelection} />
                  : <Text selectable style={styles.rewrite}>{detail.originalText}</Text>}
                <CardSectionCopyButton onPress={() => void copySection(learningText)} />
              </CollapsibleCardSection>
              : expressionPending
                ? <PendingGenerationSection target="expression" />
                : <FailedGenerationSection target="expression" retrying={retryingGenerationTarget === "expression"} onRetry={onRetryGeneration} />}
          </View>
          {detail.replyText ? <CollapsibleCardSection label={t("card_detail.reply")} collapsed={collapsedSections.reply} onToggle={() => toggleSection("reply")}>
            <View style={styles.replyContentRow}>
              <View style={styles.replyTextContent}>
                <SelectableMessageText text={detail.replyText} style={styles.secondaryContent} enableDictionaryMenu enableClozeMenu={false} onSelectionStart={() => {
                  lockForTextSelection();
                }} onSelectionEnd={unlockTextSelection} onDictionarySelection={(payload) => lookupText(detail.replyText!, payload)} />
              </View>
              <Pressable accessibilityLabel={t("card_detail.a11y.play_reply")} disabled={replyPlaybackLoading} style={styles.inlineSentencePlay} onPress={playReply}>
                {replyPlaybackLoading
                  ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                  : replyPlaying
                    ? <Ionicons name="stop" size={18} color={theme.colors.textSecondary} />
                    : <Ionicons name="play" size={17} color={theme.colors.textSecondary} />}
              </Pressable>
            </View>
            <CardSectionCopyButton onPress={() => void copySection(detail.replyText!)} />
          </CollapsibleCardSection> : pendingGenerationTargets.includes("reply") ? <PendingGenerationSection target="reply" /> : failedGenerationTargets.includes("reply") ? <FailedGenerationSection target="reply" retrying={retryingGenerationTarget === "reply"} onRetry={onRetryGeneration} /> : null}
          {relatedContent}
        </KeyboardAwareScrollView>
      </View>
      <View pointerEvents={cardFace === "back" ? "auto" : "none"} style={[styles.flipCardFace, cardFace !== "back" && styles.flipCardFaceHidden]}>
        <ScrollView style={styles.flipCardScroll} contentContainerStyle={styles.flipCardContent} keyboardShouldPersistTaps="handled" alwaysBounceVertical={false}>
          <View style={styles.cardTitleRow}>
            <Text numberOfLines={2} style={[styles.cardDisplayTitle, styles.cardDisplayTitleInRow]}>{detail.displayTitle}</Text>
          </View>
          <Text style={styles.date}>{formatDate(detail.dateKey)} · {formatTime(detail.createdAt)}</Text>
          {rewriteIsPrimary && detail.originalText.trim() ? <CollapsibleCardSection label={t("card_detail.my_record")} collapsed={collapsedSections.original} onToggle={() => toggleSection("original")}>
            <Text selectable style={styles.original}>{detail.originalText}</Text>
            <CardSectionCopyButton onPress={() => void copySection(detail.originalText)} />
          </CollapsibleCardSection> : null}
          {detail.translationText ? <CollapsibleCardSection label={t("card_detail.translation")} collapsed={collapsedSections.translation} onToggle={() => toggleSection("translation")}>
            <Text selectable style={styles.secondaryContent}>{detail.translationText}</Text>
            <CardSectionCopyButton onPress={() => void copySection(detail.translationText!)} />
          </CollapsibleCardSection> : pendingGenerationTargets.includes("translation") ? <PendingGenerationSection target="translation" /> : failedGenerationTargets.includes("translation") ? <FailedGenerationSection target="translation" retrying={retryingGenerationTarget === "translation"} onRetry={onRetryGeneration} /> : null}
        </ScrollView>
      </View>
      </Animated.View>
    </View>
    {onRecallFinish ? <Pressable style={styles.recallFinishButton} onPress={onRecallFinish}><Text style={styles.recallFinishButtonText}>{t("recall.end_node")}</Text><Ionicons name="checkmark" size={18} color={theme.colors.surface} /></Pressable> : null}
    {cardFace === "front" && frontLearningReady && fillMode && clozeInputMode === "choice" && choiceTrayOptions.length ? <View style={styles.detailChoiceTray}>
      {choiceTrayOptions.map((option) => <Pressable
        key={option.value}
        disabled={savingCloze}
        style={[styles.clozeChoiceOption, option.incorrect && styles.clozeChoiceOptionIncorrect]}
        onPress={() => choiceAnswerHandlerRef.current(option.value)}
      >
        <Text numberOfLines={2} style={[styles.clozeChoiceOptionText, option.incorrect && styles.clozeChoiceOptionTextIncorrect]}>{option.value}</Text>
      </Pressable>)}
    </View> : null}
    <View ref={actionBarRef} style={styles.detailActionBar}>
      <DetailActionButton label={t("card_detail.flip")} icon="swap-horizontal-outline" active={cardFace === "back"} onPress={flipCard} />
      <DetailActionButton label={t("card_detail.tab.dictation")} icon="headset-outline" disabled={cardFace !== "front" || !practiceEnabled || !canUseDictation || !frontLearningReady} onPress={onOpenDictation} />
      <DetailActionButton label={answersVisible ? t("card_detail.dictation.hide_answer") : t("card_detail.dictation.show_answer")} icon={answersVisible ? "eye-off-outline" : "eye-outline"} active={answersVisible} disabled={cardFace !== "front" || !practiceEnabled || !hasBlanks || !frontLearningReady} onPress={() => setAnswersVisible((current) => !current)} />
      <DetailActionButton label={t("card_detail.cloze.keyboard_mode")} textIcon={t("card_detail.tab.cloze_short")} active={fillMode && clozeInputMode === "keyboard" && cardFace === "front"} disabled={cardFace !== "front" || !practiceEnabled || !hasBlanks || !frontLearningReady} onPress={() => toggleClozeMode("keyboard")} />
      <DetailActionButton label={t("card_detail.cloze.choice_mode")} textIcon={t("card_detail.tab.choice_short")} active={fillMode && clozeInputMode === "choice" && cardFace === "front"} disabled={cardFace !== "front" || !practiceEnabled || blankCount < 2 || !frontLearningReady} onPress={() => toggleClozeMode("choice")} />
      <DetailActionButton label={t("card_detail.a11y.play_all")} icon={articlePlaying ? "pause" : "play"} loading={frontLearningReady ? articlePlaybackLoading : false} disabled={cardFace !== "front" || detail.source !== "card" || !frontLearningReady} onPress={() => articlePlaybackActive ? toggleTtsPlayback() : void playArticle()} />
    </View>
    <DictionaryPopover
      visible={Boolean(dictionary)}
      anchor={dictionary?.anchor}
      term={dictionary?.term ?? ""}
      loading={dictionary?.loading ?? false}
      error={dictionary?.error}
      result={dictionary?.result}
      canUseTts
      onClose={() => { dictionaryRequestRef.current += 1; setDictionary(null); }}
    />
    <Modal visible={Boolean(blankAction)} transparent animationType="none" statusBarTranslucent onRequestClose={() => setBlankAction(null)}>
      <Pressable style={styles.blankActionBackdrop} onPress={() => setBlankAction(null)}>
        {blankAction ? <View style={[
          styles.blankActionMenu,
          {
            left: Math.max(12, Math.min(reviewWindowWidth - 196, blankAction.anchor.pageX + blankAction.anchor.width / 2 - 92)),
            top: Math.max(54, blankAction.anchor.pageY - 52),
          },
        ]}>
          <Pressable style={styles.blankActionMenuButton} onPress={lookupBlankAction}>
            <Ionicons name="search-outline" size={17} color={theme.colors.text} />
            <Text style={styles.blankActionMenuText}>{t("card_detail.lookup")}</Text>
          </Pressable>
          <View style={styles.blankActionMenuDivider} />
          <Pressable style={styles.blankActionMenuButton} onPress={() => {
            const blank = blankAction.blank;
            setBlankAction(null);
            void removeBlank(blank);
          }}>
            <Ionicons name="trash-outline" size={17} color={theme.colors.danger} />
            <Text style={styles.blankActionMenuDeleteText}>{t("cloze.delete")}</Text>
          </Pressable>
        </View> : null}
      </Pressable>
    </Modal>
    </View>
  );
}

function CollapsibleCardSection({ label, collapsed, onToggle, compact = false, children }: { label: string; collapsed: boolean; onToggle: () => void; compact?: boolean; children: React.ReactNode }) {
  return <View style={!compact ? styles.flipCardSection : undefined}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: !collapsed }} style={styles.collapsibleSectionHeader} onPress={onToggle}>
      <Text style={styles.sectionLabelInline}>{label}</Text>
      <Ionicons name={collapsed ? "chevron-down" : "chevron-up"} size={17} color={theme.colors.textMuted} />
    </Pressable>
    {!collapsed ? children : null}
  </View>;
}

function PendingGenerationSection({ target }: { target: CardGenerationTarget }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 1050, easing: Easing.linear, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [progress]);
  const label = generationTargetLabel(target);
  return <View style={styles.pendingGenerationSection}>
    <Text style={styles.sectionLabelInline}>{label}</Text>
    <View style={styles.generatingDots}>{[0, 1, 2].map((index) => <Animated.View key={index} style={[styles.generatingDot, { opacity: progress.interpolate({ inputRange: [0, .33, .66, 1], outputRange: index === 0 ? [.25, 1, .25, .25] : index === 1 ? [.25, .25, 1, .25] : [.25, .25, .25, 1] }) }]} />)}</View>
  </View>;
}

function generationTargetLabel(target: CardGenerationTarget): string {
  return target === "translation"
    ? t("card_detail.module.translation_description")
    : target === "reply"
      ? t("card_detail.module.reply_description")
      : t("card_detail.module.expression_description");
}

function FailedGenerationSection({ target, retrying, onRetry }: {
  target: CardGenerationTarget;
  retrying: boolean;
  onRetry?: (target: CardGenerationTarget) => void;
}) {
  const label = generationTargetLabel(target);
  return <View style={styles.failedGenerationSection}>
    <View style={styles.failedGenerationCopy}>
      <Text style={styles.sectionLabelInline}>{label}</Text>
      <Text style={styles.failedGenerationText}>{t("card_detail.not_generated")}</Text>
    </View>
    <Pressable disabled={retrying} style={styles.failedGenerationRetry} onPress={() => onRetry?.(target)}>
      {retrying ? <ActivityIndicator size="small" color={theme.colors.text} /> : <Ionicons name="refresh" size={18} color={theme.colors.text} />}
    </Pressable>
  </View>;
}

function CardSectionCopyButton({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityLabel={t("card_detail.copy")} hitSlop={8} style={styles.cardSectionCopyButton} onPress={onPress}>
    <Ionicons name="copy-outline" size={17} color={theme.colors.textMuted} />
  </Pressable>;
}

function DetailActionButton({ label, icon, textIcon, active = false, loading = false, disabled = false, onPress }: {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  textIcon?: string;
  active?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return <Pressable
    accessibilityLabel={label}
    disabled={disabled || loading}
    style={[styles.detailActionButton, active && styles.detailActionButtonActive, disabled && styles.detailActionButtonDisabled]}
    onPress={onPress}
  >
    {loading
      ? <ActivityIndicator size="small" color={theme.colors.text} />
      : textIcon
        ? <Text style={[styles.clozeToolbarText, active && styles.clozeToolbarTextActive]}>{textIcon}</Text>
        : icon ? <Ionicons name={icon} size={21} color={active ? theme.colors.surface : theme.colors.textSecondary} /> : null}
  </Pressable>;
}

function RelationFocusText({ relation, currentOriginalText }: {
  relation: { recordId: string; topic: string | null; card: CardRelationPreview | null; reasons: CardRelationReason[] };
  currentOriginalText: string;
}) {
  const progress = relation.reasons.find(
    (reason): reason is Extract<CardRelationReason, { type: "progress" }> => reason.type === "progress",
  );
  const phrase = relation.reasons.find(
    (reason): reason is Extract<CardRelationReason, { type: "phrase" }> => reason.type === "phrase",
  );
  // A progress relation represents the moment the user independently used an
  // expression that had previously appeared in a cloze. Keep the focus on the
  // user's current wording, rather than repeating the older AI expression.
  const matchedExpression = progress?.currentExpression || phrase?.surfaceText || "";
  const text = progress
    ? sentenceContaining(currentOriginalText, progress.currentExpression) || progress.currentExpression
    : phrase?.sentence || relation.card?.rewrittenText || relation.card?.originalText || t("card_detail.another_record");
  if (!matchedExpression) return <Text numberOfLines={2} style={styles.relationExcerpt}>{text}</Text>;
  const index = text.toLocaleLowerCase().indexOf(matchedExpression.toLocaleLowerCase());
  if (index < 0) return <Text numberOfLines={2} style={styles.relationExcerpt}>{text}</Text>;
  return (
    <Text numberOfLines={3} style={styles.relationExcerpt}>
      {text.slice(0, index)}
      <Text style={styles.relationMatch}>{text.slice(index, index + matchedExpression.length)}</Text>
      {text.slice(index + matchedExpression.length)}
    </Text>
  );
}

function sentenceContaining(text: string, expression: string): string {
  const index = text.toLocaleLowerCase().indexOf(expression.toLocaleLowerCase());
  if (index < 0) return "";
  const boundaries = new Set([".", "!", "?", "。", "！", "？", "\n"]);
  let start = index;
  while (start > 0 && !boundaries.has(text[start - 1]!)) start -= 1;
  let end = index + expression.length;
  while (end < text.length && !boundaries.has(text[end]!)) end += 1;
  if (end < text.length && text[end] !== "\n") end += 1;
  return text.slice(start, end).trim();
}

function ReasonBadge({ reason }: { reason: CardRelationReason }) {
  const label = reason.type === "topic"
    ? t("card_detail.relation.content_related")
    : reason.type === "phrase"
      ? tf(reason.evidence === "clozed" ? "card_detail.relation.clozed_phrase" : "card_detail.relation.shared_phrase", { phrase: reason.phrase })
      : tf("card_detail.relation.progress_phrase", { phrase: reason.phrase });
  return <View style={[styles.reasonBadge, reason.type === "progress" && styles.reasonProgress, reason.type === "phrase" && styles.reasonPhrase]}><Text style={styles.reasonText}>{label}</Text></View>;
}

function Cloze({ detail, contentBinding, clozeState, clozeVersion, onClozeChange, onAddBlank, onBlankLongPress, onPlaySentence, embedded = false, fillMode = false, inputMode = "keyboard", answersVisible = false, activeSentenceKey = null, loadingSentenceKey = null, onChoiceOptionsChange, onChoiceAnswerHandlerChange, onPendingClozeCheckHandlerChange, onClozeAttempt, onTextSelectionStart, onTextSelectionEnd }: {
  detail: CardRecordDetail;
  contentBinding: CardContentBinding;
  clozeState: CardClozeState;
  clozeVersion: number;
  onClozeChange: (state: CardClozeState, version: number) => void;
  onAddBlank?: (segment: CardRecordDetail["rewriteSegments"][number], payload: NativeTextSelectionPayload) => void;
  onBlankLongPress?: (blank: CardClozeState["blanks"][number], anchor?: CardBlankActionAnchor) => void;
  onPlaySentence?: (row: CardClozeSentenceRow) => void;
  embedded?: boolean;
  fillMode?: boolean;
  inputMode?: ClozeInputMode;
  answersVisible?: boolean;
  activeSentenceKey?: string | null;
  loadingSentenceKey?: string | null;
  onChoiceOptionsChange?: (options: ClozeChoiceOption[]) => void;
  onChoiceAnswerHandlerChange?: (handler: ((value: string) => void) | null) => void;
  onPendingClozeCheckHandlerChange?: (handler: PendingClozeCheckHandler | null) => void;
  onClozeAttempt?: (input: { recordId: string; blankId: string; correct: boolean }) => void;
  onTextSelectionStart?: () => void;
  onTextSelectionEnd?: () => void;
}) {
  const { showNotice } = useFloatingNotice();
  const sentenceRows = useMemo(() => buildCardClozeSentenceRows(detail, clozeState, embedded), [detail, clozeState, embedded]);
  const orderedBlankIndexes = useMemo(
    () => sentenceRows.flatMap((row) => row.blanks.map(({ blankIndex }) => blankIndex)),
    [sentenceRows],
  );
  const firstChoiceBlankIndex = orderedBlankIndexes[0] ?? null;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checkedAnswers, setCheckedAnswers] = useState<Record<string, "correct" | "incorrect">>({});
  const [activeChoiceBlankIndex, setActiveChoiceBlankIndex] = useState<number | null>(() => fillMode && inputMode === "choice" ? firstChoiceBlankIndex : null);
  const [saving, setSaving] = useState(false);
  const [dictionary, setDictionary] = useState<DictionaryLookupState | null>(null);
  const dictionaryRequestRef = useRef(0);
  const pendingCheckHandlerRef = useRef<PendingClozeCheckHandler>(async () => undefined);
  const effectiveActiveChoiceBlankIndex = fillMode && inputMode === "choice"
    ? activeChoiceBlankIndex
    : null;
  useLayoutEffect(() => {
    setAnswers({});
    setCheckedAnswers({});
  }, [detail.id, contentBinding.contentType, contentBinding.contentVersion]);
  useLayoutEffect(() => {
    setActiveChoiceBlankIndex(fillMode && inputMode === "choice" ? firstChoiceBlankIndex : null);
    if (!fillMode) Keyboard.dismiss();
  }, [detail.id, contentBinding.contentType, contentBinding.contentVersion, fillMode, inputMode, firstChoiceBlankIndex]);
  const choiceOptions = useMemo(() => {
    if (effectiveActiveChoiceBlankIndex === null) return [];
    const activeBlank = clozeState.blanks[effectiveActiveChoiceBlankIndex];
    if (!activeBlank) return [];
    const correctKey = normalizeAnswer(activeBlank.answer);
    const distractors = clozeState.blanks
      .map((blank) => blank.answer.trim())
      .filter((answer, index, all) => normalizeAnswer(answer) !== correctKey && all.findIndex((candidate) => normalizeAnswer(candidate) === normalizeAnswer(answer)) === index);
    if (!distractors.length) return [];
    const seed = Array.from(activeBlank.id).reduce((sum, character) => (sum * 31 + character.codePointAt(0)!) >>> 0, 7);
    const distractor = distractors[seed % distractors.length]!;
    return seed % 2 === 0 ? [activeBlank.answer, distractor] : [distractor, activeBlank.answer];
  }, [effectiveActiveChoiceBlankIndex, clozeState.blanks]);

  async function check(blankIndex: number, answerOverride?: string): Promise<void> {
    const blank = clozeState.blanks[blankIndex];
    const submittedAnswer = answerOverride ?? (blank ? answers[blank.id] : undefined) ?? "";
    if (!blank || !submittedAnswer.trim() || saving) return;
    const answerCorrect = normalizeAnswer(submittedAnswer) === normalizeAnswer(blank.answer);
    void Haptics.notificationAsync(answerCorrect ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    void (answerCorrect ? playSuccessFeedbackSound() : playIncorrectFeedbackSound()).catch(() => undefined);
    onClozeAttempt?.({ recordId: detail.id, blankId: blank.id, correct: answerCorrect });
    const nextChecked = {
      ...checkedAnswers,
      [blank.id]: answerCorrect ? "correct" as const : "incorrect" as const,
    };
    setCheckedAnswers(nextChecked);
    const revealedBlankIndexes = new Set(answersVisible ? clozeState.blanks.map((_, index) => index) : []);
    const allChecked = clozeState.blanks.every((candidate, index) => nextChecked[candidate.id] || revealedBlankIndexes.has(index));
    let effectiveVersion = clozeVersion;
    if (answerCorrect && !blank.mastered) {
      setSaving(true);
      try {
        let practice;
        try {
          practice = await saveCardClozeUpdate(detail.id, {
            ...contentBinding,
            baseVersion: effectiveVersion,
            operation: { type: "master", blankId: blank.id },
          });
        } catch (error) {
          if (!(error instanceof CardApiError) || error.code !== "CARD_PRACTICE_CONFLICT") throw error;
          const latest = await getCardRecord(detail.id);
          const latestPractice = contentPractice(latest, contentBinding);
          const latestState = asCardClozeState(latestPractice?.clozeState);
          const latestVersion = latestPractice?.clozeVersion ?? 0;
          if (latestState.blanks.find((candidate) => candidate.id === blank.id)?.mastered) {
            practice = latestPractice;
          } else {
            practice = await saveCardClozeUpdate(detail.id, {
              ...contentBinding,
              baseVersion: latestVersion,
              operation: { type: "master", blankId: blank.id },
            });
          }
        }
        if (practice) {
          effectiveVersion = practice.clozeVersion;
          onClozeChange(asCardClozeState(practice.clozeState), practice.clozeVersion);
        }
      } catch (error) {
        setSaving(false);
        showNotice({ message: error instanceof Error ? error.message : t("card_detail.practice_unsaved"), type: "error", position: "top-center" });
        return;
      } finally {
        if (!allChecked) setSaving(false);
      }
    }
    if (!allChecked) return;
    const next = revealedBlankIndexes.size > 0
      ? "revealed"
      : clozeState.blanks.every((candidate) => nextChecked[candidate.id] === "correct") ? "correct" : "incorrect";
    setSaving(true);
    try {
      let practice = await saveCardClozeUpdate(detail.id, {
        ...contentBinding,
        baseVersion: effectiveVersion,
        operation: { type: "result" },
        result: next,
      });
      if (!practice) return;
      onClozeChange(asCardClozeState(practice.clozeState), practice.clozeVersion);
    } catch (error) {
      if (error instanceof CardApiError && error.code === "CARD_PRACTICE_CONFLICT") {
        try {
          const latest = await getCardRecord(detail.id);
          const latestVersion = contentPractice(latest, contentBinding)?.clozeVersion ?? 0;
          const practice = await saveCardClozeUpdate(detail.id, {
            ...contentBinding,
            baseVersion: latestVersion,
            operation: { type: "result" },
            result: next,
          });
          onClozeChange(asCardClozeState(practice.clozeState), practice.clozeVersion);
          return;
        } catch (retryError) {
          showNotice({ message: retryError instanceof Error ? retryError.message : t("card_detail.practice_unsaved"), type: "error", position: "top-center" });
          return;
        }
      }
      showNotice({ message: error instanceof Error ? error.message : t("card_detail.practice_unsaved"), type: "error", position: "top-center" });
    } finally { setSaving(false); }
  }

  async function checkPendingAnswers(): Promise<void> {
    if (!fillMode || saving) return;
    const pending = clozeState.blanks
      .map((blank, blankIndex) => ({ blank, blankIndex, answer: answers[blank.id] ?? "" }))
      .filter(({ blank, answer }) => answer.trim() && !checkedAnswers[blank.id]);
    if (!pending.length) return;

    const nextChecked = { ...checkedAnswers };
    const outcomes = pending.map(({ blank, blankIndex, answer }) => {
      const correct = normalizeAnswer(answer) === normalizeAnswer(blank.answer);
      nextChecked[blank.id] = correct ? "correct" : "incorrect";
      onClozeAttempt?.({ recordId: detail.id, blankId: blank.id, correct });
      return { blank, blankIndex, correct };
    });
    setCheckedAnswers(nextChecked);

    let effectiveState = clozeState;
    let effectiveVersion = clozeVersion;
    const applyPractice = (practice: Awaited<ReturnType<typeof saveCardClozeUpdate>>): void => {
      if (!practice) return;
      effectiveState = asCardClozeState(practice.clozeState);
      effectiveVersion = practice.clozeVersion;
      onClozeChange(effectiveState, effectiveVersion);
    };

    setSaving(true);
    try {
      for (const { blank, correct } of outcomes) {
        if (!correct || effectiveState.blanks.find((candidate) => candidate.id === blank.id)?.mastered) continue;
        try {
          const practice = await saveCardClozeUpdate(detail.id, {
            ...contentBinding,
            baseVersion: effectiveVersion,
            operation: { type: "master", blankId: blank.id },
          });
          applyPractice(practice);
        } catch (error) {
          if (!(error instanceof CardApiError) || error.code !== "CARD_PRACTICE_CONFLICT") throw error;
          const latest = await getCardRecord(detail.id);
          const latestPractice = contentPractice(latest, contentBinding);
          effectiveState = asCardClozeState(latestPractice?.clozeState);
          effectiveVersion = latestPractice?.clozeVersion ?? 0;
          const latestBlank = effectiveState.blanks.find((candidate) => candidate.id === blank.id);
          if (!latestBlank || latestBlank.mastered) {
            onClozeChange(effectiveState, effectiveVersion);
            continue;
          }
          const practice = await saveCardClozeUpdate(detail.id, {
            ...contentBinding,
            baseVersion: effectiveVersion,
            operation: { type: "master", blankId: blank.id },
          });
          applyPractice(practice);
        }
      }

      const revealedBlankIndexes = new Set(answersVisible ? clozeState.blanks.map((_, index) => index) : []);
      const allChecked = clozeState.blanks.every((blank, index) => nextChecked[blank.id] || revealedBlankIndexes.has(index));
      if (!allChecked) return;
      const result = revealedBlankIndexes.size > 0
        ? "revealed" as const
        : clozeState.blanks.every((blank) => nextChecked[blank.id] === "correct") ? "correct" as const : "incorrect" as const;
      try {
        const practice = await saveCardClozeUpdate(detail.id, {
          ...contentBinding,
          baseVersion: effectiveVersion,
          operation: { type: "result" },
          result,
        });
        applyPractice(practice);
      } catch (error) {
        if (!(error instanceof CardApiError) || error.code !== "CARD_PRACTICE_CONFLICT") throw error;
        const latest = await getCardRecord(detail.id);
        const latestVersion = contentPractice(latest, contentBinding)?.clozeVersion ?? 0;
        const practice = await saveCardClozeUpdate(detail.id, {
          ...contentBinding,
          baseVersion: latestVersion,
          operation: { type: "result" },
          result,
        });
        applyPractice(practice);
      }
    } catch (error) {
      showNotice({ message: error instanceof Error ? error.message : t("card_detail.practice_unsaved"), type: "error", position: "top-center" });
    } finally {
      setSaving(false);
    }
  }

  pendingCheckHandlerRef.current = checkPendingAnswers;

  function chooseAnswer(value: string): void {
    const blankIndex = effectiveActiveChoiceBlankIndex;
    if (blankIndex === null || saving) return;
    const activeBlank = clozeState.blanks[blankIndex];
    if (!activeBlank) return;
    setAnswers((current) => ({ ...current, [activeBlank.id]: value }));
    const answerCorrect = normalizeAnswer(value) === normalizeAnswer(activeBlank.answer);
    void check(blankIndex, value);
    if (!answerCorrect) return;
    const nextIndex = orderedBlankIndexes.find((candidateIndex) => {
      const blank = clozeState.blanks[candidateIndex];
      return candidateIndex !== blankIndex && blank && checkedAnswers[blank.id] !== "correct";
    });
    setActiveChoiceBlankIndex(nextIndex ?? null);
  }

  const chooseAnswerRef = useRef(chooseAnswer);
  chooseAnswerRef.current = chooseAnswer;
  const externalChoiceOptions = useMemo<ClozeChoiceOption[]>(() => {
    if (!fillMode || inputMode !== "choice") return [];
    const activeBlankId = effectiveActiveChoiceBlankIndex === null ? null : clozeState.blanks[effectiveActiveChoiceBlankIndex]?.id;
    return choiceOptions.map((value) => {
      const selected = Boolean(activeBlankId) && normalizeAnswer(answers[activeBlankId!] ?? "") === normalizeAnswer(value);
      return { value, incorrect: Boolean(selected && checkedAnswers[activeBlankId!] === "incorrect") };
    });
  }, [answers, checkedAnswers, choiceOptions, clozeState.blanks, effectiveActiveChoiceBlankIndex, fillMode, inputMode]);
  useEffect(() => {
    onChoiceOptionsChange?.(externalChoiceOptions);
  }, [externalChoiceOptions, onChoiceOptionsChange]);
  useEffect(() => {
    if (!onChoiceAnswerHandlerChange) return undefined;
    onChoiceAnswerHandlerChange((value) => chooseAnswerRef.current(value));
    return () => onChoiceAnswerHandlerChange(null);
  }, [onChoiceAnswerHandlerChange]);
  useEffect(() => {
    if (!onPendingClozeCheckHandlerChange) return undefined;
    onPendingClozeCheckHandlerChange(() => pendingCheckHandlerRef.current());
    return () => onPendingClozeCheckHandlerChange(null);
  }, [onPendingClozeCheckHandlerChange]);
  useEffect(() => () => onChoiceOptionsChange?.([]), [onChoiceOptionsChange]);

  function lookupInSentence(row: CardClozeSentenceRow, term: string, start: number, end: number, anchor?: NativeTextSelectionPayload["selectionRect"]): void {
    Keyboard.dismiss();
    const sequence = dictionaryRequestRef.current + 1;
    dictionaryRequestRef.current = sequence;
    setDictionary({ term, loading: true, error: null, result: null, anchor, segmentId: row.segmentId, start, end });
    void lookupDictionary({ term, context: row.text, selectionStart: start, selectionEnd: end, targetLanguage: detail.languageCode, uiLanguage: getLanguage(), contactId: "curious_companion", messageId: null })
      .then((lookupResult) => {
        if (dictionaryRequestRef.current === sequence) setDictionary((current) => current ? { ...current, loading: false, result: lookupResult, error: null } : null);
      })
      .catch((error) => {
        if (dictionaryRequestRef.current === sequence) setDictionary((current) => current ? { ...current, loading: false, error: t(dictionaryLookupErrorKey(error)) } : null);
      });
  }
  const practice = !embedded && !clozeState.blanks.length ? (
        <View style={styles.emptyPracticeCard}>
          <Ionicons name="text-outline" size={28} color={theme.colors.accentStrong} />
          <Text style={styles.emptyPracticeTitle}>{t("card_detail.practice_empty")}</Text>
          <Text style={styles.practiceHint}>{t("card_detail.practice_empty_hint")}</Text>
        </View>
      ) : (
          <View style={[styles.clozeSentenceList, embedded && styles.inlineClozeSentenceList]}>{sentenceRows.map((row) => {
            const segment = detail.rewriteSegments.find((candidate) => candidate.id === row.segmentId);
            return <View key={row.key} style={[styles.clozeSentenceRow, embedded && styles.inlineClozeSentenceRow]}>
              <View style={styles.clozeSentenceBody}>
                <StableCardSentence
                  row={row}
                  answers={answers}
                  checkedAnswers={checkedAnswers}
                  revealed={answersVisible}
                  saving={saving}
                  active={activeSentenceKey === row.key}
                  loading={loadingSentenceKey === row.key}
                  fillMode={fillMode}
                  inputMode={inputMode}
                  activeChoiceBlankIndex={effectiveActiveChoiceBlankIndex}
                  onLookup={(term, start, end, anchor) => lookupInSentence(row, term, start, end, anchor)}
                  onAddBlank={!fillMode && segment && !saving ? (payload) => onAddBlank?.(segment, payload) : undefined}
                  onBlankLongPress={onBlankLongPress}
                  onPlay={() => onPlaySentence?.(row)}
                  onTextSelectionStart={onTextSelectionStart}
                  onTextSelectionEnd={onTextSelectionEnd}
                  onCheckAnswer={(blankIndex) => void check(blankIndex)}
                  onActivateChoiceBlank={setActiveChoiceBlankIndex}
                  onChangeAnswer={(blankIndex, value) => {
                    const blankId = clozeState.blanks[blankIndex]?.id;
                    if (!blankId) return;
                    setAnswers((current) => ({ ...current, [blankId]: value }));
                    setCheckedAnswers((current) => { const next = { ...current }; delete next[blankId]; return next; });
                  }}
                />
              </View>
            </View>;
          })}
          {!onChoiceOptionsChange && fillMode && inputMode === "choice" && choiceOptions.length ? <View style={styles.clozeChoiceTray}>
            {choiceOptions.map((option) => {
              const activeBlankId = effectiveActiveChoiceBlankIndex === null ? null : clozeState.blanks[effectiveActiveChoiceBlankIndex]?.id;
              const selected = Boolean(activeBlankId) && normalizeAnswer(answers[activeBlankId!] ?? "") === normalizeAnswer(option);
              const incorrect = selected && checkedAnswers[activeBlankId!] === "incorrect";
              return <Pressable key={option} disabled={saving} style={[styles.clozeChoiceOption, incorrect && styles.clozeChoiceOptionIncorrect]} onPress={() => chooseAnswer(option)}>
                <Text numberOfLines={2} style={[styles.clozeChoiceOptionText, incorrect && styles.clozeChoiceOptionTextIncorrect]}>{option}</Text>
              </Pressable>;
            })}
          </View> : null}
          </View>
      );
  const dictionaryPopover = <DictionaryPopover visible={Boolean(dictionary)} anchor={dictionary?.anchor} term={dictionary?.term ?? ""} loading={dictionary?.loading ?? false} error={dictionary?.error} result={dictionary?.result} canUseTts onClose={() => { dictionaryRequestRef.current += 1; setDictionary(null); }} />;
  if (embedded) return <View style={styles.inlineClozePractice}>{practice}{dictionaryPopover}</View>;
  return <View style={styles.reviewPage}><KeyboardAwareScrollView bottomOffset={16} extraKeyboardSpace={12} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.practiceContent} alwaysBounceVertical={false}>{practice}</KeyboardAwareScrollView>{dictionaryPopover}</View>;
}

function StableCardSentence({ row, answers, checkedAnswers, revealed, saving, active, loading, fillMode, inputMode, activeChoiceBlankIndex, onLookup, onAddBlank, onBlankLongPress, onPlay, onChangeAnswer, onCheckAnswer, onActivateChoiceBlank, onTextSelectionStart, onTextSelectionEnd }: {
  row: CardClozeSentenceRow;
  answers: Record<string, string>;
  checkedAnswers: Record<string, "correct" | "incorrect">;
  revealed: boolean;
  saving: boolean;
  active: boolean;
  loading: boolean;
  fillMode: boolean;
  inputMode: ClozeInputMode;
  activeChoiceBlankIndex: number | null;
  onLookup: (term: string, start: number, end: number, anchor?: NativeTextSelectionPayload["selectionRect"]) => void;
  onAddBlank?: (payload: NativeTextSelectionPayload) => void;
  onBlankLongPress?: (blank: CardClozeState["blanks"][number], anchor?: CardBlankActionAnchor) => void;
  onPlay: () => void;
  onChangeAnswer: (blankIndex: number, value: string) => void;
  onCheckAnswer: (blankIndex: number) => void;
  onActivateChoiceBlank: (blankIndex: number) => void;
  onTextSelectionStart?: () => void;
  onTextSelectionEnd?: () => void;
}) {
  const sentencePlayback = React.useSyncExternalStore(subscribeTtsPlayback, getTtsPlaybackState, getTtsPlaybackState);
  const sentenceLoading = loading || (active && sentencePlayback.status === "loading");
  const sentencePlaying = active && sentencePlayback.status === "playing";
  const sentenceText = row.text.slice(row.textStart, row.textEnd);
  const selectableSentence = <SelectableMessageText
    text={sentenceText}
    style={styles.clozeSentence}
    highlightRanges={row.blanks.map(({ blank }, index) => ({ start: blank.startUtf16 - row.textStart, end: blank.endUtf16 - row.textStart, groupIndex: index }))}
    blankRanges={row.blanks.map(({ blank }) => ({ start: blank.startUtf16 - row.textStart, end: blank.endUtf16 - row.textStart }))}
    correctRanges={row.blanks.filter(({ blank }) => blank.mastered).map(({ blank }) => ({ start: blank.startUtf16 - row.textStart, end: blank.endUtf16 - row.textStart }))}
    answersVisible={revealed}
    enableDictionaryMenu
    enableClozeMenu={!fillMode && !saving}
    onSelectionStart={() => {
      onTextSelectionStart?.();
    }}
    onSelectionEnd={onTextSelectionEnd}
    onDictionarySelection={(payload) => onLookup(payload.selectedText, row.textStart + payload.start, row.textStart + payload.end, payload.selectionRect)}
    onSelectionChange={(payload) => {
      if (fillMode) return;
      onAddBlank?.({ ...payload, start: row.textStart + payload.start, end: row.textStart + payload.end });
    }}
    onClozeRangePress={(index, selectionRect) => {
      const selected = row.blanks[index];
      if (selected) onBlankLongPress?.(selected.blank, selectionRect);
    }}
  />;
  return <View style={[styles.stableSentence, active && styles.stableSentenceActive]}>
    <View style={styles.stableSentenceContent}>
      {!fillMode ? selectableSentence : <View>
        <View>
          <CardBlankSentenceFlow
            row={row}
            answers={answers}
            checkedAnswers={checkedAnswers}
            revealed={revealed}
            saving={saving}
            fillMode={fillMode}
            inputMode={inputMode}
            activeChoiceBlankIndex={activeChoiceBlankIndex}
            onLookup={onLookup}
            onBlankLongPress={onBlankLongPress}
            onChangeAnswer={onChangeAnswer}
            onCheckAnswer={onCheckAnswer}
            onActivateChoiceBlank={onActivateChoiceBlank}
          />
        </View>
      </View>}
    </View>
    <Pressable
      accessibilityLabel={t("card_detail.a11y.play_sentence")}
      style={styles.inlineSentencePlay}
      disabled={sentenceLoading}
      onPress={() => active ? stopTtsAudio() : onPlay()}
    >
      {sentenceLoading
        ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        : sentencePlaying
          ? <Ionicons name="stop" size={18} color={theme.colors.textSecondary} />
          : <Ionicons name="play" size={17} color={theme.colors.textSecondary} />}
    </Pressable>
  </View>;
}

type CardClozeSentenceRow = {
  key: string;
  segmentId: string;
  text: string;
  textStart: number;
  textEnd: number;
  blanks: Array<{ blank: CardClozeState["blanks"][number]; blankIndex: number }>;
};

function buildCardClozeSentenceRows(detail: CardRecordDetail, clozeState: CardClozeState, includeUnblanked = false): CardClozeSentenceRow[] {
  return detail.rewriteSegments.flatMap((segment) => {
    const segmentBlanks = clozeState.blanks
      .map((blank, blankIndex) => ({ blank, blankIndex }))
      .filter(({ blank }) => blank.segmentId === segment.id)
      .sort((left, right) => left.blank.startUtf16 - right.blank.startUtf16);
    if (!segmentBlanks.length && !includeUnblanked) return [];
    const rows = [{
      key: `${segment.id}:sentence-0-${segment.text.length}`,
      segmentId: segment.id,
      text: segment.text,
      textStart: 0,
      textEnd: segment.text.length,
      blanks: segmentBlanks,
    }].filter((row) => includeUnblanked || row.blanks.length > 0);
    return rows.length ? rows : [{ key: `${segment.id}:sentence-fallback`, segmentId: segment.id, text: segment.text, textStart: 0, textEnd: segment.text.length, blanks: segmentBlanks }];
  });
}

function ClozePracticeBlank({ expectedText, answer, checked, mastered = false, revealed = false, editing = false, fillEnabled = true, inputMode = "keyboard", choiceActive = false, disabled = false, onLongPress, onChangeAnswer, onCheck, onActivateChoice }: {
  expectedText: string;
  answer: string;
  checked?: "correct" | "incorrect";
  mastered?: boolean;
  revealed?: boolean;
  editing?: boolean;
  fillEnabled?: boolean;
  inputMode?: ClozeInputMode;
  choiceActive?: boolean;
  disabled?: boolean;
  onLongPress: (anchor?: CardBlankActionAnchor) => void;
  onChangeAnswer: (value: string) => void;
  onCheck: () => void;
  onActivateChoice?: () => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const feedbackMotion = useRef(new Animated.Value(0)).current;
  const previousChecked = useRef<typeof checked>(undefined);
  const underlineUnits = useMemo(() => splitCardClozeAnswerUnits(expectedText), [expectedText]);
  const showInput = fillEnabled && editing && inputMode === "keyboard" && !revealed;
  const choiceEnabled = fillEnabled && editing && inputMode === "choice" && !revealed;
  const coloredAnswer = !revealed && checked === "incorrect" ? renderCheckedClozeAnswer(expectedText, answer) : null;
  useEffect(() => {
    if (!checked || checked === previousChecked.current) return;
    previousChecked.current = checked;
    feedbackMotion.stopAnimation();
    feedbackMotion.setValue(0);
    if (checked === "correct") {
      Animated.sequence([
        Animated.spring(feedbackMotion, { toValue: 1, friction: 4, tension: 180, useNativeDriver: true }),
        Animated.spring(feedbackMotion, { toValue: 0, friction: 5, tension: 150, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(feedbackMotion, { toValue: 1, duration: 55, useNativeDriver: true }),
        Animated.timing(feedbackMotion, { toValue: -1, duration: 70, useNativeDriver: true }),
        Animated.timing(feedbackMotion, { toValue: 0.55, duration: 60, useNativeDriver: true }),
        Animated.timing(feedbackMotion, { toValue: 0, duration: 55, useNativeDriver: true }),
      ]).start();
    }
  }, [checked, feedbackMotion]);
  return <Animated.View style={[styles.cardBlankUnit, { transform: checked === "correct"
    ? [{ scale: feedbackMotion.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }]
    : [{ translateX: feedbackMotion.interpolate({ inputRange: [-1, 1], outputRange: [-7, 7] }) }] }] }>
    <Pressable
      style={styles.cardBlankField}
      onPress={showInput || choiceEnabled ? () => {
        if (choiceEnabled) onActivateChoice?.();
        else inputRef.current?.focus();
      } : (event: GestureResponderEvent) => onLongPress({
        pageX: event.nativeEvent.pageX,
        pageY: event.nativeEvent.pageY,
        width: 1,
        height: 24,
      })}
    >
      <Text
        pointerEvents="none"
        numberOfLines={1}
        style={styles.cardBlankMeasure}
      >{expectedText || " "}</Text>
      <View pointerEvents="none" style={[
        styles.cardBlankBackground,
        (mastered || checked === "correct") && styles.cardBlankBackgroundCorrect,
        checked === "incorrect" && styles.cardBlankBackgroundIncorrect,
        choiceActive && styles.cardBlankBackgroundChoiceActive,
      ]} />
      <View pointerEvents="none" style={styles.cardBlankUnderlineRow}>
        {(underlineUnits.length ? underlineUnits : [expectedText || " "]).map((unit, index) => (
          <View
            key={`${index}-${unit}`}
            style={[styles.cardBlankUnderlineSegment, choiceActive && styles.cardBlankUnderlineSegmentActive, { flex: Math.max(1, Array.from(unit).length) }]}
          />
        ))}
      </View>
      <View style={styles.cardBlankContent}>
        {showInput ? <>
          <TextInput ref={inputRef} accessibilityLabel={t("card_detail.tab.cloze")} value={answer} editable={!disabled} onChangeText={onChangeAnswer} autoCapitalize="none" autoCorrect={false} selectionColor={theme.colors.text} style={styles.cardBlankInput} />
          <Text pointerEvents="none" numberOfLines={1} style={styles.cardBlankCheckedText}>{coloredAnswer ?? answer}</Text>
        </> : <Text pointerEvents="none" numberOfLines={1} style={styles.cardBlankStaticText}>{revealed ? expectedText : choiceEnabled ? answer : ""}</Text>}
      </View>
    </Pressable>
    <Pressable
      accessibilityLabel={t("card_detail.dictation.check")}
      disabled={!fillEnabled || inputMode === "choice" || !answer.trim() || disabled || revealed}
      style={[
        styles.cardBlankCheckButton,
        fillEnabled && inputMode === "keyboard" && !revealed && (!answer.trim() || disabled) && styles.cardBlankCheckButtonDisabled,
        !fillEnabled || inputMode === "choice" ? styles.cardBlankCheckButtonRemoved : revealed ? styles.cardBlankCheckButtonHidden : null,
      ]}
      onPress={onCheck}
    >
      <Ionicons name="checkmark" size={13} color={theme.colors.textMuted} />
    </Pressable>
  </Animated.View>;
}

function renderCheckedClozeAnswer(expectedText: string, answer: string): React.ReactNode[] {
  const unitMatches = getCardClozeActualUnitMatches(expectedText, answer);
  const parts = answer.split(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}'’-]+)/gu);
  let unitIndex = 0;
  return parts.filter(Boolean).map((part, index) => {
    const isUnit = /^(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}'’-]+)$/u.test(part);
    const matched = isUnit ? unitMatches[unitIndex++] : false;
    return <Text key={`${index}-${part}`} style={isUnit && matched ? styles.cardBlankCheckedWordCorrect : styles.cardBlankCheckedWordIncorrect}>{part}</Text>;
  });
}

function CardBlankSentenceFlow({ row, answers, checkedAnswers, revealed, saving, fillMode, inputMode, activeChoiceBlankIndex, onLookup, onAddBlank, onBlankLongPress, onChangeAnswer, onCheckAnswer, onActivateChoiceBlank }: {
  row: CardClozeSentenceRow;
  answers: Record<string, string>;
  checkedAnswers: Record<string, "correct" | "incorrect">;
  revealed: boolean;
  saving: boolean;
  fillMode: boolean;
  inputMode: ClozeInputMode;
  activeChoiceBlankIndex: number | null;
  onLookup: (term: string, start: number, end: number) => void;
  onAddBlank?: (start: number, end: number, selectedText: string) => void;
  onBlankLongPress?: (blank: CardClozeState["blanks"][number], anchor?: CardBlankActionAnchor) => void;
  onChangeAnswer: (blankIndex: number, value: string) => void;
  onCheckAnswer: (blankIndex: number) => void;
  onActivateChoiceBlank: (blankIndex: number) => void;
}) {
  const content: React.ReactNode[] = [];
  let cursor = row.textStart;
  row.blanks.forEach(({ blank, blankIndex }) => {
    if (blank.startUtf16 > cursor) content.push(...renderClozeLookupText(row.text, cursor, blank.startUtf16, onLookup, onAddBlank));
    const answer = answers[blank.id] ?? "";
    const checked = checkedAnswers[blank.id];
    content.push(<ClozePracticeBlank
      key={blank.id}
      expectedText={blank.answer}
      answer={answer}
      checked={checked}
      mastered={blank.mastered}
      revealed={revealed}
      editing={fillMode}
      fillEnabled={fillMode}
      inputMode={inputMode}
      choiceActive={inputMode === "choice" && activeChoiceBlankIndex === blankIndex}
      disabled={saving}
      onLongPress={(anchor) => onBlankLongPress?.(blank, anchor)}
      onChangeAnswer={(value) => onChangeAnswer(blankIndex, value)}
      onCheck={() => onCheckAnswer(blankIndex)}
      onActivateChoice={() => onActivateChoiceBlank(blankIndex)}
    />);
    cursor = blank.endUtf16;
  });
  if (cursor < row.textEnd) content.push(...renderClozeLookupText(row.text, cursor, row.textEnd, onLookup, onAddBlank));
  return <View style={styles.clozeFlow}>{content}</View>;
}

function renderClozeLookupText(text: string, start: number, end: number, onLookup: (term: string, start: number, end: number) => void, onAddBlank?: (start: number, end: number, selectedText: string) => void): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const chunk = text.slice(start, end);
  const pattern = /[A-Za-z][A-Za-z'’-]*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(chunk))) {
    if (match.index > cursor) nodes.push(<Text key={`plain-${start + cursor}`} style={styles.clozeSentence}>{chunk.slice(cursor, match.index)}</Text>);
    const wordStart = start + match.index;
    const word = match[0];
    nodes.push(<Pressable
      key={`word-${wordStart}`}
      accessibilityLabel={tf("card_detail.a11y.lookup_word", { word })}
      delayLongPress={320}
      style={({ pressed }) => [styles.clozeLookupWord, pressed && styles.clozeLookupWordPressed]}
      onPress={() => onLookup(word, wordStart, wordStart + word.length)}
      onLongPress={onAddBlank ? () => onAddBlank(wordStart, wordStart + word.length, word) : undefined}
    >
      <Text style={styles.clozeSentence}>{word}</Text>
    </Pressable>);
    cursor = match.index + word.length;
  }
  if (cursor < chunk.length) nodes.push(<Text key={`plain-${start + cursor}`} style={styles.clozeSentence}>{chunk.slice(cursor)}</Text>);
  return nodes;
}

function asCardClozeState(value: unknown): CardClozeState {
  if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1 || !("blanks" in value) || !Array.isArray(value.blanks)) {
    return { schemaVersion: 1, blanks: [] };
  }
  return value as CardClozeState;
}

function Dictation({ detail, contentBinding }: { detail: CardRecordDetail; contentBinding: CardContentBinding }) {
  const rows = useMemo(() => detail.rewriteSegments.map((segment) => ({
    key: `${segment.id}-0`,
    text: segment.text.trim(),
    segmentId: segment.id,
    startUtf16: 0,
    endUtf16: segment.text.length,
  })).filter((sentence) => sentence.text), [detail.id, detail.rewrittenText, detail.rewriteSegments]);
  const sentences = useMemo(() => rows.map(({ key, text }) => ({ key, text })), [rows]);
  return <DictationPracticeView
    sentences={sentences}
    onPlay={async (sentence) => {
      const row = rows.find((candidate) => candidate.key === sentence.key);
      if (!row) return;
      const sessionId = beginTtsPlaybackSession();
      const audio = await getCardSegmentAudio({
        entryId: detail.id.slice("card:".length),
        segmentId: row.segmentId,
        sourceKind: "dictation_sentence",
        startUtf16: row.startUtf16,
        endUtf16: row.endUtf16,
        ...contentBinding,
      });
      if (!isTtsPlaybackSessionCurrent(sessionId)) return;
      await playTtsAudio({ url: audio.audioUrl, sessionId });
    }}
  />;
}

function normalizeAnswer(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}
function formatDate(value: string): string { const [year, month, day] = value.split("-").map(Number); return new Intl.DateTimeFormat(getLanguage(), { year: "numeric", month: "long", day: "numeric" }).format(new Date(year, month - 1, day)); }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(getLanguage(), { hour: "2-digit", minute: "2-digit" }); }

const styles = StyleSheet.create({
  collapsibleSectionHeader: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 },
  pendingGenerationSection: { minHeight: 68, marginTop: 24, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, gap: 12 },
  generatingDots: { height: 18, flexDirection: "row", alignItems: "center", gap: 5 },
  generatingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.textSecondary },
  failedGenerationSection: { minHeight: 64, marginTop: 24, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  failedGenerationCopy: { gap: 5 },
  failedGenerationText: { color: theme.colors.textMuted, fontSize: 14 },
  failedGenerationRetry: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  fullscreen: { ...StyleSheet.absoluteFillObject, zIndex: 50, backgroundColor: theme.colors.canvas },
  page: { flex: 1, backgroundColor: theme.colors.canvas },
  header: { height: 54, paddingHorizontal: 8, flexDirection: "row", alignItems: "center" },
  headerButton: { width: 64, minHeight: 44, justifyContent: "center" }, close: { color: theme.colors.textSecondary, fontSize: 15 }, title: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 16, fontWeight: "500" },
  historyButtons: { width: 82, flexDirection: "row", alignItems: "center" },
  historyButton: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  headerEnd: { width: 82, flexDirection: "row", justifyContent: "flex-end" },
  iconHeaderButton: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  detailActionLayer: { ...StyleSheet.absoluteFillObject, zIndex: 80, elevation: 80 },
  detailActionMenu: { position: "absolute", top: 49, right: 14, width: 132, paddingVertical: 4, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 12 },
  detailActionItem: { minHeight: 43, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  detailActionText: { color: theme.colors.text, fontSize: 15, lineHeight: 20 },
  detailActionDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 10, backgroundColor: theme.colors.border },
  clozeGuideOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 90, elevation: 90 },
  clozeGuideCopy: { position: "absolute", left: 32, right: 32, alignItems: "center" },
  clozeGuideProgress: { marginBottom: 10, color: "rgba(255,255,255,0.7)", fontSize: 12, lineHeight: 17, fontWeight: "600", letterSpacing: 1.1 },
  clozeGuideText: { maxWidth: 310, color: "#FFFFFF", fontSize: 19, lineHeight: 29, fontWeight: "500", letterSpacing: 0.2, textAlign: "center", textShadowColor: "rgba(0,0,0,0.24)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
  clozeGuideButtonWrap: { width: 126, height: 48, marginTop: 22, transform: [{ rotate: "-1.5deg" }] },
  clozeGuideButtonShadow: { position: "absolute", left: 4, right: -4, top: 5, bottom: -5, borderRadius: 24, backgroundColor: "#B9A7F5" },
  clozeGuideButton: { flex: 1, borderWidth: 1, borderColor: "rgba(23,23,27,0.12)", borderRadius: 24, backgroundColor: "#FFFDF8", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  clozeGuideButtonText: { color: "#17171B", fontSize: 15, lineHeight: 21, fontWeight: "600", letterSpacing: 0.4 },
  clozeActionGuideCard: { width: "100%", maxWidth: 340, paddingHorizontal: 15, paddingTop: 14, paddingBottom: 15, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)" },
  clozeActionGuideTitle: { marginBottom: 12, color: "#FFFFFF", fontSize: 17, lineHeight: 23, fontWeight: "600", textAlign: "center" },
  clozeActionGuideGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 12 },
  clozeActionGuideItem: { width: "50%", paddingRight: 7, flexDirection: "row", alignItems: "center", gap: 8 },
  clozeActionGuideIcon: { width: 29, height: 29, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  clozeActionGuideTextIcon: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, fontWeight: "600" },
  clozeActionGuideItemCopy: { flex: 1, minWidth: 0 },
  clozeActionGuideLabel: { color: "#FFFFFF", fontSize: 12, lineHeight: 17, fontWeight: "600" },
  clozeActionGuideDetail: { color: "rgba(255,255,255,0.64)", fontSize: 10, lineHeight: 14 },
  draftHeaderSide: { width: 82, minHeight: 44, justifyContent: "center" },
  draftCloseButton: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
  draftCreateTitle: { flex: 1, color: theme.colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" },
  cardTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardDisplayTitleInRow: { flex: 1 },
  articlePlayButton: { width: 36, height: 32, marginTop: -1, alignItems: "flex-end", justifyContent: "center" },
  loader: { marginTop: 40 }, recallDetailPage: { flex: 1, backgroundColor: theme.colors.canvas }, recallAdjacentPage: { position: "absolute", top: 0, bottom: 0, width: "100%", backgroundColor: theme.colors.canvas }, recallAdjacentSafeArea: { flex: 1, backgroundColor: theme.colors.canvas }, reviewPage: { flex: 1, backgroundColor: theme.colors.canvas }, content: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 88 }, flipCardStage: { flex: 1, marginHorizontal: 10, marginTop: 4, marginBottom: 10 }, flipCardShell: { flex: 1, position: "relative", borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 18, backgroundColor: theme.colors.surface, overflow: "hidden" }, flipCardFace: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.surface }, flipCardFaceHidden: { opacity: 0 }, flipCardScroll: { flex: 1 }, flipCardContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 }, flipCardTextBlock: { marginTop: 2 }, flipCardSection: { marginTop: 24, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }, cardSectionCopyButton: { width: 34, height: 32, marginTop: 5, marginRight: -5, alignSelf: "flex-end", alignItems: "center", justifyContent: "center", borderRadius: 16 }, cardDisplayTitle: { marginBottom: 6, color: theme.colors.text, fontSize: 23, lineHeight: 30, fontWeight: "600" }, date: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "400" }, imageCarousel: { marginTop: 18, borderRadius: 10, backgroundColor: theme.colors.surfaceMuted }, image: { width: "100%", aspectRatio: CARD_IMAGE_ASPECT_RATIO, borderRadius: 10, backgroundColor: theme.colors.surfaceMuted }, carouselImagePage: { borderRadius: 10, overflow: "hidden", backgroundColor: theme.colors.surfaceMuted }, carouselImageLayer: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" }, coverMoveHint: { position: "absolute", right: 10, bottom: 10, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,28,24,0.56)" }, imageDots: { height: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, imageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D2D2D2" }, imageDotActive: { backgroundColor: theme.colors.text }, reviewImageActions: { minHeight: 30, flexDirection: "row", justifyContent: "flex-end", alignItems: "center" }, reviewAddImage: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 3, paddingLeft: 10 }, reviewAddImageText: { color: theme.colors.accentStrong, fontSize: 14 }, sectionLabel: { marginTop: 22, color: theme.colors.textMuted, fontSize: 12, fontWeight: "500" }, original: { marginTop: 8, color: theme.colors.textMuted, fontSize: 17, lineHeight: 28, fontWeight: "400" }, secondaryContent: { marginTop: 8, color: theme.colors.textSecondary, fontSize: 17, lineHeight: 28, fontWeight: "400" }, rewrite: { marginTop: 5, color: theme.colors.text, fontSize: 17, lineHeight: 28, fontWeight: "400" }, divider: { marginTop: 28, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
  recallFinishButton: { height: 42, marginHorizontal: 18, marginBottom: 8, paddingHorizontal: 18, borderRadius: 21, backgroundColor: theme.colors.text, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, recallFinishButtonText: { color: theme.colors.surface, fontSize: 15, fontWeight: "600" },
  imagePreviewPage: { flex: 1, backgroundColor: "transparent" },
  imagePreviewBackdrop: { backgroundColor: theme.colors.canvas },
  imagePreviewHeader: { height: 58, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  imagePreviewHeaderButton: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  imagePreviewHeaderStart: { width: 92, height: 46, alignItems: "flex-start", justifyContent: "center" },
  imagePreviewHeaderEnd: { width: 92, height: 46, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  imagePreviewCounter: { flex: 1, color: theme.colors.textSecondary, fontSize: 14, fontWeight: "500", textAlign: "center" },
  imagePreviewPageItem: { alignItems: "center", justifyContent: "flex-start", backgroundColor: theme.colors.canvas },
  imagePreviewImage: { backgroundColor: theme.colors.canvas },
  cropShade: { position: "absolute", backgroundColor: "rgba(0,0,0,0.48)" },
  previewCropOverlay: { zIndex: 20, elevation: 20 },
  previewCropFrame: { position: "absolute", zIndex: 20, elevation: 20, borderWidth: 2, borderColor: "#FFFFFF", shadowColor: "#000000", shadowOpacity: 0.28, shadowRadius: 5, shadowOffset: { width: 0, height: 1 } },
  imagePreviewTransitionImage: { position: "absolute", overflow: "hidden", backgroundColor: theme.colors.surfaceMuted },
  imagePreviewTransitionFill: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  imagePreviewFooter: { minHeight: 76, paddingHorizontal: 24, paddingTop: 18, alignItems: "center" },
  imagePreviewDate: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  imageAddingPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: theme.colors.surfaceMuted },
  imageAddingText: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  detailActionBar: { minHeight: 54, paddingHorizontal: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  detailChoiceTray: { paddingHorizontal: 18, paddingTop: 9, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", gap: 9 },
  detailActionButton: { width: 48, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  detailActionButtonActive: { backgroundColor: theme.colors.text },
  detailActionButtonDisabled: { opacity: 0.28 },
  clozeToolbarText: { color: theme.colors.textSecondary, fontSize: 16, lineHeight: 21, fontWeight: "600" },
  clozeToolbarTextActive: { color: theme.colors.surface },
  blankActionBackdrop: { flex: 1, backgroundColor: "transparent" },
  blankActionMenu: { position: "absolute", width: 184, height: 44, zIndex: 40, elevation: 40, paddingHorizontal: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 12, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 11, shadowOffset: { width: 0, height: 4 } },
  blankActionMenuButton: { flex: 1, height: 36, paddingHorizontal: 7, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  blankActionMenuDivider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: theme.colors.border },
  blankActionMenuText: { color: theme.colors.text, fontSize: 13, fontWeight: "500" },
  blankActionMenuDeleteText: { color: theme.colors.danger, fontSize: 13, fontWeight: "500" },
  practiceContent: { padding: 20, paddingBottom: 44 }, practiceHint: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 }, answerInput: { marginTop: 18, minHeight: 50, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.control, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 16 }, dictationInput: { minHeight: 120, paddingTop: 13 }, primaryButton: { marginTop: 14, minHeight: 48, borderRadius: theme.radius.control, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accentStrong }, primaryButtonText: { color: theme.colors.surface, fontSize: 15, fontWeight: "600" }, secondaryButton: { marginTop: 10, minHeight: 44, alignItems: "center", justifyContent: "center" }, secondaryButtonText: { color: theme.colors.accentStrong, fontSize: 14 }, result: { marginTop: 16, fontSize: 14, textAlign: "center" }, correct: { color: theme.colors.success }, incorrect: { color: theme.colors.danger }, answerReveal: { marginTop: 16, padding: 14, borderRadius: theme.radius.control, backgroundColor: theme.colors.accentSoft, color: theme.colors.text, fontSize: 16, lineHeight: 24 }, audioPlaceholder: { minHeight: 88, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" }, audioText: { marginTop: 7, color: theme.colors.textMuted, fontSize: 12 },
  sectionHeading: { marginTop: 18, minHeight: 30, flexDirection: "row", alignItems: "center" },
  sectionLabelInline: { flex: 1, color: theme.colors.textMuted, fontSize: 12, fontWeight: "500" },
  replyContentRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  replyTextContent: { flex: 1, minWidth: 0 },
  dictationSentenceList: { gap: 12 },
  dictationSentenceRow: { flexDirection: "row", alignItems: "flex-start" },
  dictationSentenceBody: { flex: 1 },
  dictationSentenceNumber: { marginBottom: 1, color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  dictationSentenceInputStack: { position: "relative" },
  dictationSentenceInput: { minHeight: 52, paddingHorizontal: 2, paddingTop: 7, paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: theme.colors.textSecondary, backgroundColor: "transparent", color: "transparent", fontSize: 16, lineHeight: 24, fontWeight: "400", letterSpacing: 0, includeFontPadding: false },
  dictationSentenceTextOverlay: { ...StyleSheet.absoluteFillObject, paddingHorizontal: 2, paddingTop: 7, paddingBottom: 7 },
  dictationSentenceDisplayText: { color: theme.colors.text, fontSize: 16, lineHeight: 24, fontWeight: "400", letterSpacing: 0, includeFontPadding: false },
  dictationSentenceActions: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 18 },
  dictationSentenceAction: { width: 36, minHeight: 36, alignItems: "center", justifyContent: "center" },
  dictationSentenceActionDisabled: { opacity: 0.35 },
  dictationSentenceAnswer: { marginTop: 7, padding: 10, borderRadius: theme.radius.control, backgroundColor: theme.colors.accentSoft, color: theme.colors.text, fontSize: 15, lineHeight: 23 },
  selectionHint: { marginTop: 9, color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  rewriteSegments: { marginTop: 0, gap: 2 },
  clozeSaving: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  emptyPracticeCard: { minHeight: 210, padding: 24, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyPracticeTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  clozeSentenceList: { paddingVertical: 8 },
  clozeSentenceRow: { minHeight: 52, marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 9, borderRadius: theme.radius.control, flexDirection: "row", alignItems: "flex-start" },
  inlineClozePractice: { marginTop: 14 },
  inlineClozeSentenceList: { paddingVertical: 0 },
  inlineClozeSentenceRow: { minHeight: 0, marginHorizontal: 0, paddingHorizontal: 0, paddingVertical: 5 },
  clozeChoiceTray: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, flexDirection: "row", gap: 9 },
  clozeChoiceOption: { flex: 1, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 11, backgroundColor: theme.colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  clozeChoiceOptionIncorrect: { borderColor: "#D98B87", backgroundColor: "#FCE7E5" },
  clozeChoiceOptionText: { color: theme.colors.text, fontSize: 15, lineHeight: 20, fontWeight: "500", textAlign: "center" },
  clozeChoiceOptionTextIncorrect: { color: theme.colors.danger },
  stableSentence: { alignSelf: "stretch", overflow: "visible", flexDirection: "row", alignItems: "flex-end" },
  stableSentenceContent: { flex: 1, minWidth: 0 },
  stableSentenceActive: { borderRadius: 7, backgroundColor: theme.colors.surfaceMuted },
  inlineSentenceActions: { minHeight: 34, marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  inlineSentencePlay: { width: 27, height: 27, marginLeft: 2, alignItems: "center", justifyContent: "center" },
  inlineSentenceActionSpacer: { flex: 1 },
  inlineSentenceModeButton: { minHeight: 30, paddingHorizontal: 9, borderRadius: 15, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 4 },
  inlineSentenceModeButtonActive: { backgroundColor: theme.colors.text },
  inlineSentenceModeText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "600" },
  inlineSentenceModeTextActive: { color: theme.colors.surface },
  clozeSentenceRowActive: { backgroundColor: theme.colors.accentSoft },
  clozeSentencePlay: { width: 34, minHeight: 34, marginTop: -1, marginRight: -5, alignItems: "center", justifyContent: "center" },
  clozeSentenceBody: { flex: 1, paddingTop: 1 },
  clozeFlow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  clozeSentence: { color: theme.colors.text, fontSize: 17, lineHeight: 28 },
  cardBlankInput: { height: 28, paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, borderBottomWidth: 0, backgroundColor: "transparent", color: "transparent", fontSize: 17, lineHeight: 28, fontWeight: "400", letterSpacing: 0, textAlign: "left", textAlignVertical: "center", includeFontPadding: false },
  cardBlankStaticText: { height: 28, paddingHorizontal: 0, paddingVertical: 0, color: theme.colors.text, fontSize: 17, lineHeight: 28, fontWeight: "400", letterSpacing: 0, textAlign: "left", includeFontPadding: false },
  cardBlankPreview: { height: 28, marginHorizontal: 0, paddingHorizontal: 0, paddingVertical: 0, borderBottomWidth: 1, borderBottomColor: "#8C6D1F", borderRadius: 0, backgroundColor: "#FFF0B8", alignSelf: "center", justifyContent: "center" },
  cardBlankPreviewText: { color: theme.colors.text, fontSize: 17, lineHeight: 28, fontWeight: "400", letterSpacing: 0 },
  cardBlankInputRevealed: { color: theme.colors.textSecondary },
  clozeRevealButton: { alignSelf: "flex-end", minHeight: 34, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 5 },
  cardBlankInputIncorrect: { borderBottomColor: theme.colors.danger, color: theme.colors.danger },
  cardBlankCheckedText: { position: "absolute", left: 0, top: 0, height: 28, paddingHorizontal: 0, color: theme.colors.text, fontSize: 17, lineHeight: 28, fontWeight: "400", letterSpacing: 0, textAlign: "left", includeFontPadding: false },
  cardBlankCheckedWordCorrect: { color: theme.colors.success },
  cardBlankCheckedWordIncorrect: { color: theme.colors.danger },
  cardBlankUnit: { height: 28, maxWidth: "100%", flexShrink: 1, flexDirection: "row", alignItems: "center" },
  cardBlankCheckButton: { width: 20, height: 20, marginLeft: 3, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  cardBlankCheckButtonDisabled: { opacity: 0.45 },
  cardBlankCheckButtonHidden: { opacity: 0 },
  cardBlankCheckButtonRemoved: { display: "none" },
  cardBlankField: { height: 28, flexShrink: 1, position: "relative", alignItems: "center", justifyContent: "center" },
  cardBlankMeasure: { minWidth: 28, maxWidth: 240, height: 28, opacity: 0, fontSize: 17, lineHeight: 28, fontWeight: "400", letterSpacing: 0, includeFontPadding: false },
  cardBlankContent: { ...StyleSheet.absoluteFillObject },
  clozeLookupWord: { alignSelf: "center", borderRadius: 3 },
  clozeLookupWordPressed: { backgroundColor: theme.colors.accentSoft },
  cardBlankBackground: { position: "absolute", left: 0, right: 0, top: 4, bottom: 5, backgroundColor: "#FFF0B8" },
  cardBlankBackgroundCorrect: { backgroundColor: "#DDF2DF" },
  cardBlankBackgroundIncorrect: { backgroundColor: "#FCE1DF" },
  cardBlankBackgroundChoiceActive: { borderWidth: 1.5, borderColor: theme.colors.text, borderRadius: 3 },
  cardBlankUnderlineRow: { position: "absolute", left: 0, right: 0, bottom: 4, height: 1.5, flexDirection: "row", gap: 4 },
  cardBlankUnderlineSegment: { height: 1.5, backgroundColor: "#8C6D1F" },
  cardBlankUnderlineSegmentActive: { backgroundColor: theme.colors.text },
  clozeGap: { color: theme.colors.accentStrong, fontWeight: "700" },
  clozeActionText: { color: theme.colors.accentStrong, fontSize: 13 },
  inlineAudioButton: { marginTop: 10, alignSelf: "flex-start", minHeight: 36, paddingHorizontal: 11, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSoft, flexDirection: "row", alignItems: "center", gap: 6 }, inlineAudioText: { color: theme.colors.accentStrong, fontSize: 12, fontWeight: "600" },
  dictationEntry: { alignSelf: "flex-end", minHeight: 36, marginTop: 24, paddingHorizontal: 2, flexDirection: "row", alignItems: "center", gap: 6 },
  dictationEntryText: { color: theme.colors.textSecondary, fontSize: 12 },
  imageActions: { marginTop: 10, flexDirection: "row", justifyContent: "flex-end", gap: 18 },
  detailAddImagePage: { aspectRatio: CARD_IMAGE_ASPECT_RATIO, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.border, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 5 },
  detailAddImageText: { color: theme.colors.textMuted, fontSize: 12 },
  imageActionText: { color: theme.colors.accentStrong, fontSize: 13 },
  imageRemoveText: { color: theme.colors.danger, fontSize: 13 },
  relationsEntry: { marginTop: 14, minHeight: 48, paddingHorizontal: 13, borderRadius: theme.radius.control, backgroundColor: theme.colors.accentSoft, flexDirection: "row", alignItems: "center", gap: 10 },
  relationsEntryIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  relationsEntryText: { flex: 1, color: theme.colors.accentStrong, fontSize: 14, fontWeight: "700" },
  relationsSection: { marginTop: 34, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  relationsHeader: { minHeight: 40, flexDirection: "row", alignItems: "center" },
  relationsSectionTitle: { flex: 1, color: theme.colors.textSecondary, fontSize: 13, fontWeight: "400" },
  relationRow: { minHeight: 112, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  relationRowGrowth: { marginVertical: 7, paddingHorizontal: 11, borderWidth: 1, borderTopWidth: 1, borderColor: "#C4A044", borderTopColor: "#C4A044", borderRadius: 12, backgroundColor: "#FFFBEC" },
  relationThumbnail: { width: 90, height: 60, flexShrink: 0, borderRadius: 8, backgroundColor: theme.colors.surfaceMuted },
  relationContent: { flex: 1, minWidth: 0 },
  relationCardTitle: { marginBottom: 3, color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  relationDate: { marginBottom: 5, color: theme.colors.textMuted, fontSize: 11 },
  relationExcerpt: { flex: 1, color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: "400" },
  growthMomentLabel: { marginBottom: 3, color: "#9A7417", fontSize: 12, fontWeight: "700" },
  relationReasons: { marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 5 },
  relationCard: { marginTop: 10, padding: 14, borderRadius: theme.radius.control, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  relationTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  relationTitle: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  relationMatch: { color: "#8C6812", backgroundColor: "#F5E8B5", fontWeight: "700" },
  reasonList: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  reasonBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceMuted },
  reasonPhrase: { backgroundColor: theme.colors.accentSoft },
  reasonProgress: { backgroundColor: "#EAEAEA" },
  reasonText: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: "600" },
  draftContent: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 52 },
  draftContentPage: { flex: 1, paddingHorizontal: 22 },
  draftEditorScroll: { flex: 1 },
  draftEditorContent: { flexGrow: 1, paddingTop: 0, paddingBottom: 32 },
  collectionPickerRow: { minHeight: 56, paddingHorizontal: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, flexDirection: "row", alignItems: "center", gap: 8 },
  collectionPickerLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  collectionPickerLabelText: { color: theme.colors.textMuted, fontSize: 13 },
  collectionPickerValue: { flex: 1, color: theme.colors.text, fontSize: 14, textAlign: "right" },
  draftTitleInput: { minHeight: 40, marginTop: 18, paddingHorizontal: 2, paddingVertical: 4, color: theme.colors.text, fontSize: 20, lineHeight: 28, fontWeight: "500" },
  draftOriginalEditor: { minHeight: 108, marginTop: 12, paddingHorizontal: 2, paddingTop: 2 },
  draftBlockInput: { minHeight: 86, padding: 0, color: theme.colors.text, fontSize: 17, lineHeight: 27, fontWeight: "400" },
  draftBlockInputFeatured: { minHeight: 76, fontSize: 17, lineHeight: 27 },
  draftComposerToolbar: { minHeight: 50, marginHorizontal: -22, paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", gap: 8 },
  draftComposerToolbarCompact: { paddingHorizontal: 6, gap: 4 },
  draftComposerTool: { width: 42, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  draftComposerToolCompact: { width: 40 },
  draftComposerSpacer: { flex: 1 },
  draftCharacterCount: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  draftCharacterCountOver: { color: theme.colors.danger, fontWeight: "600" },
  draftComposerBadge: { position: "absolute", top: 2, right: 2, minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 8, backgroundColor: theme.colors.accentStrong, alignItems: "center", justifyContent: "center" },
  draftComposerBadgeText: { color: theme.colors.surface, fontSize: 9, fontWeight: "700" },
  draftPublishButton: { minWidth: 78, height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: theme.colors.text, alignItems: "center", justifyContent: "center" },
  draftPublishButtonCompact: { minWidth: 68, paddingHorizontal: 14 },
  draftPublishButtonDisabled: { backgroundColor: theme.colors.surfaceMuted },
  draftPublishButtonText: { color: theme.colors.surface, fontSize: 14, fontWeight: "700" },
  draftPublishButtonTextDisabled: { color: theme.colors.textMuted },
  draftAiOptionsRow: { minHeight: 46, marginHorizontal: -22, paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", gap: 4 },
  draftAiOptionsRowStacked: { paddingVertical: 6, alignItems: "stretch", flexDirection: "column", gap: 0 },
  draftAiOption: { flex: 1, minWidth: 0, height: 38, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  draftAiOptionStacked: { flex: 0, width: "100%", minHeight: 42, height: "auto", paddingHorizontal: 12, justifyContent: "flex-start" },
  draftAiOptionLabel: { flexShrink: 1, color: theme.colors.textSecondary, fontSize: 12, fontWeight: "500" },
  draftAiOptionLabelStacked: { flexShrink: 0 },
  draftAiOptionLabelSelected: { color: theme.colors.text, fontWeight: "600" },
  draftImage: { width: "100%", aspectRatio: CARD_IMAGE_ASPECT_RATIO, marginTop: 18, borderRadius: 10, backgroundColor: theme.colors.surfaceMuted },
  draftImageOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(30,35,38,0.34)", alignItems: "center", justifyContent: "center" },
  photoLayer: { ...StyleSheet.absoluteFillObject, zIndex: 30, elevation: 30, justifyContent: "flex-end" },
  photoLayerDismiss: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.28)" },
  photoLayerPanel: { height: "58%", minHeight: 330, backgroundColor: theme.colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: -6 }, elevation: 31 },
  photoLayerHeader: { height: 54, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  photoLayerTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  photoLayerClose: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surfaceMuted },
  photoLayerDone: { minHeight: 34, paddingHorizontal: 13, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accentSoft },
  photoLayerDoneText: { color: theme.colors.accentStrong, fontSize: 14, fontWeight: "600" },
  photoGridScroll: { flex: 1 },
  photoGrid: { padding: 10, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photoGridItem: { width: "32%", aspectRatio: 1, borderRadius: 7, overflow: "hidden", backgroundColor: theme.colors.surfaceMuted },
  photoGridItemSelected: { borderWidth: 3, borderColor: theme.colors.accentStrong },
  photoSelectionBadge: { position: "absolute", right: 6, top: 6, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accentStrong },
  photoSelectionBadgeText: { color: theme.colors.surface, fontSize: 12, fontWeight: "700" },
  photoGridLoading: { width: "100%", height: 100, alignItems: "center", justifyContent: "center" },
  photoLayerActions: { minHeight: 58, paddingHorizontal: 12, paddingVertical: 7, flexDirection: "row", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface },
  photoLayerAction: { flex: 1, minHeight: 44, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: theme.colors.surfaceMuted },
  photoLayerActionText: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
  photoRailImage: { width: "100%", height: "100%" },
  photoRailItem: { width: 72, height: 72, borderRadius: 8, overflow: "hidden", backgroundColor: theme.colors.surfaceMuted },
  photoRailAll: { width: 82, height: 72, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center", gap: 5 },
  photoRailAllText: { color: theme.colors.textSecondary, fontSize: 11 },
  draftProcessingLines: { paddingTop: 22, gap: 10 },
  draftProcessingLineLong: { width: "78%", height: 2, borderRadius: 1, backgroundColor: theme.colors.border },
  draftProcessingLineShort: { width: "52%", height: 2, borderRadius: 1, backgroundColor: theme.colors.border },
});
