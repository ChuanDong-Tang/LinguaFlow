import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  deleteCardImageUpload,
  getCardRecord,
  getCardCapabilities,
  updateCardContent,
  appendCardRecordImage,
  removeCardRecordImageById,
  DEFAULT_CARD_CAPABILITIES,
  type CardRecordDetail,
  type CardCapabilities,
  type CardRelationReason,
} from "../services/api/cardApi";
import {
  prepareCardDraftImage,
  removePersistentDraftImage,
  uploadCardDraftImage,
  CardImageModerationRejectedError,
} from "../services/card/cardImageUpload";
import { generateMissingCardContent, hasGeneratedContent, isCardResourceLimitedError, type CardGenerationTarget } from "../services/card/cardContentGeneration";
import { getCardGenerationState, isCardGenerationInProgress, setCardGenerationState, subscribeCardGenerationState } from "../services/card/cardGenerationState";
import { CardDetailModal } from "./CardDetailModal";
import { t, tf } from "../i18n";
import { stabilizeSignedImage } from "../services/image/signedImageCache";

const DETAIL_IMAGE_REFRESH_LEAD_MS = 60_000;

export type CardDetailRequest = {
  key: number;
  recordId: string;
  initialTab?: "review" | "cloze" | "dictation";
  initialEditing?: boolean;
  closeAfterEditing?: boolean;
  origin?: { x: number; y: number; width: number; height: number };
  returnLabel?: string;
};

type DetailImage = NonNullable<CardRecordDetail["images"]>[number];
type CachedCardDetail = {
  detail: CardRecordDetail;
  loadedAt: number;
  pendingTargets?: CardGenerationTarget[];
  failedTargets?: CardGenerationTarget[];
};
type CardDetailSnapshot = {
  detail: CardRecordDetail;
  pendingTargets: CardGenerationTarget[];
  failedTargets: CardGenerationTarget[];
};
const CARD_DETAIL_PREFETCH_FRESH_MS = 45_000;

async function stabilizeCardDetailImages(
  previous: CardRecordDetail | null | undefined,
  next: CardRecordDetail,
): Promise<CardRecordDetail> {
  const previousImages = new Map((previous?.images ?? []).map((image) => [image.id, image]));
  const [thumbnail, images, image] = await Promise.all([
    stabilizeDetailThumbnail(previous?.thumbnail, next.thumbnail),
    Promise.all((next.images ?? []).map((candidate) => stabilizeDetailImage(previousImages.get(candidate.id), candidate))),
    next.image ? stabilizeDetailImage(previous?.image, next.image) : Promise.resolve(null),
  ]);
  return {
    ...next,
    thumbnail,
    ...(next.images ? { images } : {}),
    image,
  };
}

async function stabilizeDetailThumbnail<T extends { url: string; urlExpiresAt?: string | null }>(
  previous: T | null | undefined,
  next: T | null,
): Promise<T | null> {
  if (!next) return null;
  const stable = await stabilizeSignedImage(previous, next, DETAIL_IMAGE_REFRESH_LEAD_MS);
  return { ...next, url: stable.url, urlExpiresAt: stable.urlExpiresAt };
}

async function stabilizeDetailImage(previous: DetailImage | null | undefined, next: DetailImage): Promise<DetailImage> {
  const [fullImage, thumbnail] = await Promise.all([
    stabilizeSignedImage(previous, next, DETAIL_IMAGE_REFRESH_LEAD_MS),
    next.thumbnail ? stabilizeDetailThumbnail(previous?.thumbnail ?? null, next.thumbnail) : Promise.resolve(null),
  ]);
  return {
    ...next,
    url: fullImage.url,
    urlExpiresAt: fullImage.urlExpiresAt,
    thumbnail,
  };
}

export function CardDetailNavigator({
  request,
  prefetchRecordId,
  onClose,
  onChanged,
}: {
  request: CardDetailRequest | null;
  prefetchRecordId?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CardRecordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageAdding, setImageAdding] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cardCapabilities, setCardCapabilities] = useState<CardCapabilities>(DEFAULT_CARD_CAPABILITIES);
  const [failedGenerationTargets, setFailedGenerationTargets] = useState<CardGenerationTarget[]>([]);
  const [pendingGenerationTargets, setPendingGenerationTargets] = useState<CardGenerationTarget[]>([]);
  const [retryingGenerationTarget, setRetryingGenerationTarget] = useState<CardGenerationTarget | null>(null);
  const cardLimits = cardCapabilities.limits;
  const requestSequenceRef = useRef(0);
  const detailCacheRef = useRef(new Map<string, CachedCardDetail>());
  const detailLoadsRef = useRef(new Map<string, Promise<CardDetailSnapshot>>());

  useEffect(() => {
    let active = true;
    void getCardCapabilities()
      .then((value) => { if (active) setCardCapabilities(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!prefetchRecordId) return;
    const cached = detailCacheRef.current.get(prefetchRecordId);
    if (cached && Date.now() - cached.loadedAt < CARD_DETAIL_PREFETCH_FRESH_MS) return;
    void fetchDetailSnapshot(prefetchRecordId).catch(() => undefined);
  }, [prefetchRecordId]);

  useEffect(() => {
    if (!request) {
      requestSequenceRef.current += 1;
      setDetail(null);
      setHistory([]);
      setHistoryIndex(-1);
      setFailedGenerationTargets([]);
      setPendingGenerationTargets([]);
      return;
    }
    const cached = detailCacheRef.current.get(request.recordId);
    setDetail(cached?.detail ?? null);
    setPendingGenerationTargets(cached?.pendingTargets ?? []);
    setFailedGenerationTargets(cached?.failedTargets ?? []);
    setHistory([request.recordId]);
    setHistoryIndex(0);
    void loadDetail(request.recordId);
  }, [request?.key]);

  async function loadDetail(recordId: string): Promise<CardRecordDetail | null> {
    const cached = detailCacheRef.current.get(recordId);
    if (cached) {
      setDetail(cached.detail);
      setPendingGenerationTargets(cached.pendingTargets ?? []);
      setFailedGenerationTargets(cached.failedTargets ?? []);
    }
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setLoading(!cached);
    try {
      const snapshot = await fetchDetailSnapshot(recordId);
      if (requestSequenceRef.current !== sequence) return null;
      setDetail(snapshot.detail);
      setPendingGenerationTargets(snapshot.pendingTargets);
      setFailedGenerationTargets(snapshot.failedTargets);
      return snapshot.detail;
    } catch {
      if (requestSequenceRef.current === sequence) {
        Alert.alert(t("card_practice.error.open"), t("card_detail.error.try_again"));
      }
      return null;
    } finally {
      if (requestSequenceRef.current === sequence) setLoading(false);
    }
  }

  function fetchDetailSnapshot(recordId: string): Promise<CardDetailSnapshot> {
    const inFlight = detailLoadsRef.current.get(recordId);
    if (inFlight) return inFlight;
    const load = (async () => {
      const cached = detailCacheRef.current.get(recordId);
      const [resolved, generationState] = await Promise.all([getCardRecord(recordId), getCardGenerationState(recordId)]);
      const stableDetail = await stabilizeCardDetailImages(cached?.detail, resolved);
      const pendingTargets = (generationState?.pendingTargets ?? []).filter((target) => !hasGeneratedContent(stableDetail, target));
      const failedTargets = (generationState?.failedTargets ?? []).filter((target) => !hasGeneratedContent(stableDetail, target));
      const snapshot = { detail: stableDetail, pendingTargets, failedTargets };
      detailCacheRef.current.set(recordId, { ...snapshot, loadedAt: Date.now() });
      return snapshot;
    })().finally(() => detailLoadsRef.current.delete(recordId));
    detailLoadsRef.current.set(recordId, load);
    return load;
  }

  useEffect(() => subscribeCardGenerationState((recordId, state) => {
    if (!request || request.recordId !== recordId) return;
    setPendingGenerationTargets(state?.pendingTargets ?? []);
    setFailedGenerationTargets(state?.failedTargets ?? []);
    if (!state?.pendingTargets.length) void loadDetail(recordId);
  }), [request?.key]);

  async function openRelated(recordId: string, _reasons: CardRelationReason[]): Promise<void> {
    if (!await loadDetail(recordId)) return;
    const next = [...history.slice(0, historyIndex + 1), recordId].slice(-100);
    setHistory(next);
    setHistoryIndex(next.length - 1);
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
    onClose();
  }

  async function retryGeneration(target: CardGenerationTarget): Promise<void> {
    if (!detail || retryingGenerationTarget) return;
    if (isCardGenerationInProgress()) {
      Alert.alert(t("card_detail.processing"), t("card_detail.processing_existing"));
      return;
    }
    setRetryingGenerationTarget(target);
    try {
      await setCardGenerationState(detail.id, { pendingTargets: [target], failedTargets: failedGenerationTargets.filter((candidate) => candidate !== target) });
      const generation = await generateMissingCardContent(detail, [target]);
      const stableDetail = await stabilizeCardDetailImages(detail, generation.detail);
      setDetail(stableDetail);
      detailCacheRef.current.set(detail.id, { detail: stableDetail, loadedAt: Date.now() });
      const failedTargets = generation.failedTargets.length
        ? failedGenerationTargets
        : failedGenerationTargets.filter((candidate) => candidate !== target);
      setFailedGenerationTargets(failedTargets);
      await setCardGenerationState(detail.id, failedTargets.length ? { pendingTargets: [], failedTargets } : null);
      onChanged();
      if (generation.resourceLimited) Alert.alert(t("card_detail.processing"), t("card_detail.processing_existing"));
    } catch {
      // Keep the local retry state visible without interrupting the card.
      await setCardGenerationState(detail.id, { pendingTargets: [], failedTargets: failedGenerationTargets });
    } finally {
      setRetryingGenerationTarget(null);
    }
  }

  async function pickImage(recordId: string, source: "camera" | "library", suppliedAsset?: { uri: string; width: number; height: number }): Promise<void> {
    const remaining = cardLimits.imagesPerCard - (detail?.images?.length ?? (detail?.image ? 1 : 0));
    if (remaining <= 0) {
      Alert.alert(tf("card_detail.photo.limit_title_dynamic", { count: cardLimits.imagesPerCard }), t("card_detail.photo.limit_message"));
      return;
    }
    if (suppliedAsset) {
      await appendPickedImages(recordId, [suppliedAsset]);
      return;
    }
    if (source === "camera" || Platform.OS !== "android") {
      const permission = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("me.profile.photo_permission"), source === "camera" ? t("card_detail.photo.camera_permission_message") : t("card_detail.photo.library_permission_message"));
        return;
      }
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsMultipleSelection: true, selectionLimit: remaining });
    const selected = result.assets?.filter((asset) => asset.uri && asset.width && asset.height).slice(0, remaining) ?? [];
    if (result.canceled || !selected.length) return;
    await appendPickedImages(recordId, selected);
  }

  async function appendPickedImages(recordId: string, selected: Array<{ uri: string; width: number; height: number }>): Promise<void> {
    setImageAdding(true);
    try {
      let updated = detail;
      for (const asset of selected) {
        let prepared: Awaited<ReturnType<typeof prepareCardDraftImage>> | null = null;
        let uploadId: string | null = null;
        try {
          prepared = await prepareCardDraftImage(asset);
          const ready = await uploadCardDraftImage(prepared, () => undefined);
          if (!ready.uploadId) throw new Error(t("card_detail.photo.upload_incomplete"));
          uploadId = ready.uploadId;
          updated = await stabilizeCardDetailImages(updated, await appendCardRecordImage(recordId, uploadId));
          uploadId = null;
        } finally {
          if (uploadId) void deleteCardImageUpload(uploadId).catch(() => undefined);
          if (prepared) removePersistentDraftImage(prepared.localUri);
        }
      }
      if (!updated) return;
      setDetail(updated);
      detailCacheRef.current.set(recordId, { detail: updated, loadedAt: Date.now() });
      onChanged();
    } catch (error) {
      Alert.alert(
        t("card_detail.photo.add_failed_title"),
        error instanceof CardImageModerationRejectedError
          ? t("card_detail.photo.moderation_rejected_message")
          : error instanceof Error
            ? `${error.message}\n${t("common.retry")}`
            : t("card_detail.photo.add_failed_message"),
      );
    } finally {
      setImageAdding(false);
    }
  }

  function confirmRemoveImage(imageId?: string): void {
    const images = detail?.images ?? [];
    const image = images.find((candidate) => candidate.id === imageId) ?? images[0] ?? detail?.image;
    if (!detail || !image) return;
    const recordId = detail.id;
    Alert.alert(t("card_detail.photo.remove_title"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: () => void removeCardRecordImageById(recordId, image.id)
          .then(async (updated) => {
            const stableDetail = await stabilizeCardDetailImages(detail, updated);
            setDetail(stableDetail);
            detailCacheRef.current.set(recordId, { detail: stableDetail, loadedAt: Date.now() });
            onChanged();
          })
          .catch(() => Alert.alert(t("card_detail.photo.remove_failed_title"), t("card_detail.photo.remove_failed_message"))),
      },
    ]);
  }

  if (!request || (!detail && request.returnLabel)) return null;
  const canNavigateBack = historyIndex > 0 && Boolean(history[historyIndex - 1]);
  const canNavigateForward = historyIndex >= 0 && historyIndex < history.length - 1 && Boolean(history[historyIndex + 1]);
  return (
      <CardDetailModal
        key={request.key}
        detail={detail}
        loading={loading}
        imageAdding={imageAdding}
        draftLimits={cardLimits}
      failedGenerationTargets={failedGenerationTargets}
      pendingGenerationTargets={pendingGenerationTargets}
      retryingGenerationTarget={retryingGenerationTarget}
      onRetryGeneration={(target) => void retryGeneration(target)}
      transitionOrigin={historyIndex === 0 ? request.origin : undefined}
      initialTab={request.initialTab}
      initialEditing={request.initialEditing}
      closeAfterEditing={request.closeAfterEditing}
        onClose={close}
        returnLabel={request?.returnLabel}
      canGoBack={canNavigateBack}
      canGoForward={canNavigateForward}
      onBack={canNavigateBack ? () => void navigateHistory(historyIndex - 1) : undefined}
      onForward={canNavigateForward ? () => void navigateHistory(historyIndex + 1) : undefined}
      onOpenRelated={(recordId, reasons) => void openRelated(recordId, reasons)}
      hideRelations={historyIndex > 0}
      onUpdateContent={async (input) => {
        if (!detail) return false;
        if (isCardGenerationInProgress(detail.id)) {
          Alert.alert(t("card_detail.processing"), t("card_detail.processing_existing"));
          return false;
        }
        let updated: CardRecordDetail;
        try {
          updated = await updateCardContent(detail.id, {
            title: input.title,
            originalText: input.originalText,
            collectionId: input.collectionId,
            ...(!input.selectedTargets.includes("expression") ? { rewrittenText: null } : {}),
            ...(!input.selectedTargets.includes("translation") ? { translationText: null } : {}),
            ...(!input.selectedTargets.includes("reply") ? { replyText: null } : {}),
          });
        } catch (error) {
          if (!isCardResourceLimitedError(error)) throw error;
          Alert.alert(t("card_detail.processing"), t("card_detail.processing_existing"));
          return false;
        }
        updated = await stabilizeCardDetailImages(detail, updated);
        setDetail(updated);
        detailCacheRef.current.set(detail.id, { detail: updated, loadedAt: Date.now() });
        const targets = input.selectedTargets as CardGenerationTarget[];
        if (!targets.length) {
          await setCardGenerationState(detail.id, null);
          onChanged();
          return true;
        }
        await setCardGenerationState(detail.id, { pendingTargets: targets, failedTargets: [] });
        setPendingGenerationTargets(targets);
        setFailedGenerationTargets([]);
        onChanged();
        void generateMissingCardContent(updated, targets).then(async (generation) => {
          const stableDetail = await stabilizeCardDetailImages(updated, generation.detail);
          setDetail(stableDetail);
          setPendingGenerationTargets([]);
          setFailedGenerationTargets(generation.failedTargets);
          await setCardGenerationState(detail.id, generation.failedTargets.length
            ? { pendingTargets: [], failedTargets: generation.failedTargets }
            : null);
          detailCacheRef.current.set(detail.id, { detail: stableDetail, loadedAt: Date.now() });
          onChanged();
        }).catch(async () => {
          setPendingGenerationTargets([]);
          setFailedGenerationTargets(targets);
          await setCardGenerationState(detail.id, { pendingTargets: [], failedTargets: targets });
          onChanged();
        });
        return true;
      }}
      onReplaceImage={detail ? (source, asset) => void pickImage(detail.id, source, asset) : undefined}
      onRemoveImage={(detail?.images?.length ?? 0) > 0 || detail?.image ? confirmRemoveImage : undefined}
    />
  );
}
