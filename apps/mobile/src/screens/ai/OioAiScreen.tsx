import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import Reanimated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Text } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { OioMascot } from "../../components/sketch/OioMascot";
import { coverFillFor } from "../../components/surface/Surface";
import { haptic } from "../../feedback/haptics";
import { getLanguage, t, tf } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";
import { motion } from "../../motion";
import { useAndroidBack } from "../../hooks/useAndroidBack";
import { generateCardAutomaticCloze } from "../../services/api/cardApi";
import {
  deleteOioAiThread, getOioAiOpener, listOioAiMessages, listOioAiThreads, OioAiError, saveOioAiThreadAsCard, streamOioAi,
  type OioAiAction, type OioAiBlock, type OioAiCard, type OioAiThread,
} from "../../services/ai/oioAiApi";

type Turn = { id: string; role: "user" | "assistant"; text: string; blocks: OioAiBlock[]; tool?: string | null; pending?: boolean; error?: string | null };

// Before the personal opener arrives (or if it fails): light everyday topics.
const FALLBACK_TOPICS = ["oio_ai.suggest.chat_today", "oio_ai.suggest.chat_happy"] as const;
const TOOL_LABEL: Record<string, string> = {
  search_cards: "oio_ai.tool.search",
  get_card: "oio_ai.tool.read",
  practice_stats: "oio_ai.tool.stats",
  find_word_in_my_cards: "oio_ai.tool.find_word",
  start_blind_box: "oio_ai.tool.practice",
};

function errorText(code: string): string {
  if (code === "OIO_AI_MEMBERS_ONLY") return t("oio_ai.error.members_only");
  if (code === "TOKEN_QUOTA_EXCEEDED") return t("oio_ai.error.quota");
  if (code === "CONTENT_BLOCKED") return t("oio_ai.error.blocked");
  return t("oio_ai.error.generic");
}

/**
 * OIO AI (2026-11, phase 1) — replaces the rewrite assistant. Finds memories
 * and starts practice through tools; found cards show as tiles, practice as a
 * button. Notion-AI-like: one panel, suggestions first, answers stream in.
 */
export function OioAiScreen({ visible, onClose, onOpenCard, onStartBlindBox, contextCard = null }: {
  visible: boolean;
  onClose: () => void;
  onOpenCard: (recordId: string) => void;
  onStartBlindBox: (recordIds: string[]) => void;
  /** 问这张卡: the card the panel was opened from. */
  contextCard?: { recordId: string; title: string } | null;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 对话卡: the card this conversation was saved as (one per conversation).
  const [cardId, setCardId] = useState<string | null>(null);
  const [savingCard, setSavingCard] = useState(false);
  // A personal greeting + topics (from what the user records), new each visit.
  const [opener, setOpener] = useState<{ greeting: string; topics: string[] } | null>(null);
  const [openerLoading, setOpenerLoading] = useState(false);
  // 1 万字 per conversation: then save it or start a new one.
  const [full, setFull] = useState(false);
  const listRef = useRef<FlatList<Turn>>(null);
  const abortRef = useRef<AbortController | null>(null);
  useAndroidBack(visible && historyOpen, () => setHistoryOpen(false));
  useEffect(() => () => abortRef.current?.abort(), []);
  // A new card context starts a new conversation.
  useEffect(() => { if (visible && contextCard) { setThreadId(null); setTurns([]); setCardId(null); } }, [contextCard, visible]);
  const hasExchange = turns.some((turn) => turn.role === "assistant" && !turn.pending && turn.text);
  const loadOpener = useCallback((refresh = false) => {
    setOpenerLoading(true);
    void getOioAiOpener(getLanguage(), refresh).then(setOpener).catch(() => undefined).finally(() => setOpenerLoading(false));
  }, []);
  // Fresh opener for a new chat; a re-opened chat re-checks its saved card (it may be deleted).
  useEffect(() => {
    if (!visible) return;
    if (!threadId && !contextCard) { loadOpener(); return; }
    if (threadId) void listOioAiMessages(threadId).then((data) => { setCardId(data.cardId); setFull(data.full); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const saveCard = useCallback(async () => {
    if (!threadId || savingCard) return;
    if (cardId) { haptic.light(); onOpenCard(cardId); return; }
    haptic.medium();
    setSavingCard(true);
    try {
      const saved = await saveOioAiThreadAsCard(threadId);
      // Like any new card: automatic blanks on the user's lines and OIO's replies.
      if (saved.created) await generateCardAutomaticCloze(saved.recordId, ["rewrite", "reply"]).catch(() => undefined);
      setCardId(saved.recordId);
      haptic.success();
    } catch (error) {
      haptic.warning();
      const code = error instanceof OioAiError ? error.code : "NETWORK_ERROR";
      Alert.alert(t("oio_ai.save_failed_title"), code === "CONTENT_BLOCKED" ? t("oio_ai.error.blocked") : code === "TOKEN_QUOTA_EXCEEDED" ? t("oio_ai.error.quota") : t("oio_ai.error.generic"));
    } finally {
      setSavingCard(false);
    }
  }, [cardId, onOpenCard, savingCard, threadId]);

  const send = useCallback(async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    haptic.light();
    setText("");
    setBusy(true);
    const assistantId = `a-${Date.now()}`;
    // A new chat starts with OIO's greeting, then the user's answer.
    const greeting = !threadId && !contextCard && opener ? opener.greeting : null;
    setTurns((current) => [
      ...current,
      ...(greeting ? [{ id: `g-${Date.now()}`, role: "assistant" as const, text: greeting, blocks: [] }] : []),
      { id: `u-${Date.now()}`, role: "user", text: message, blocks: [] },
      { id: assistantId, role: "assistant", text: "", blocks: [], pending: true },
    ]);
    const update = (change: (turn: Turn) => Turn) => setTurns((current) => current.map((turn) => turn.id === assistantId ? change(turn) : turn));
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamOioAi({ text: message, opener: greeting, threadId, contextCardId: threadId ? null : contextCard?.recordId, appLocale: getLanguage(), signal: abort.signal }, (event) => {
        if (event.type === "thread") setThreadId(event.threadId);
        else if (event.type === "delta") update((turn) => ({ ...turn, text: turn.text + event.text, tool: null }));
        else if (event.type === "tool") update((turn) => ({ ...turn, tool: event.name }));
        else if (event.type === "cards") update((turn) => ({ ...turn, blocks: [...turn.blocks, { type: "cards", cards: event.cards }] }));
        else if (event.type === "action") {
          if (event.action.kind === "thread_full") setFull(true);
          update((turn) => ({ ...turn, blocks: [...turn.blocks, { type: "action", action: event.action }] }));
        }
      });
      update((turn) => ({ ...turn, pending: false, tool: null }));
    } catch (error) {
      const code = error instanceof OioAiError ? error.code : "NETWORK_ERROR";
      if (code !== "ABORTED") haptic.warning();
      if (code === "OIO_AI_THREAD_FULL") setFull(true);
      // A reply that failed review is not kept: clear what already streamed.
      update((turn) => ({ ...turn, pending: false, tool: null, ...(code === "CONTENT_BLOCKED" ? { text: "", blocks: [] } : {}), error: code === "ABORTED" ? null : errorText(code) }));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [busy, contextCard, opener, threadId]);

  const openThread = async (thread: OioAiThread) => {
    setHistoryOpen(false);
    abortRef.current?.abort();
    setThreadId(thread.id);
    setTurns([]);
    setCardId(thread.cardId ?? null);
    try {
      const { messages, cardId: savedCardId, full: threadFull } = await listOioAiMessages(thread.id);
      setCardId(savedCardId);
      setFull(threadFull);
      setTurns(messages.map((message) => ({ id: message.id, role: message.role, text: message.text, blocks: message.blocks ?? [] })));
    } catch {
      setTurns([{ id: "load-error", role: "assistant", text: "", blocks: [], error: t("oio_ai.error.generic") }]);
    }
  };
  const newThread = () => { haptic.select(); abortRef.current?.abort(); setThreadId(null); setTurns([]); setCardId(null); setFull(false); loadOpener(true); };

  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={historyOpen ? () => setHistoryOpen(false) : onClose}>
    <SafeAreaProvider><SafeAreaView style={styles.page} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8} style={styles.headerButton} onPress={onClose}><Icon name="close-outline" size={24} color={theme.colors.text} /></Pressable>
        <View style={styles.headerTitle}><OioMascot size={22} idle={false} /><Text style={styles.title}>OIO AI</Text></View>
        <View style={styles.headerActions}>
          {threadId && hasExchange ? <Pressable accessibilityRole="button" accessibilityLabel={t(cardId ? "oio_ai.saved_card" : "oio_ai.save_card")} disabled={savingCard || busy} hitSlop={6} style={({ pressed }) => [styles.saveChip, cardId && styles.saveChipDone, pressed && { opacity: 0.7 }]} onPress={() => void saveCard()}>
            {savingCard ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Icon name={cardId ? "checkmark-outline" : "albums-outline"} size={15} color={theme.colors.accent} />}
            <Text style={styles.saveChipText}>{t(cardId ? "oio_ai.saved_short" : "oio_ai.save_short")}</Text>
          </Pressable> : null}
          {turns.length ? <Pressable accessibilityRole="button" accessibilityLabel={t("oio_ai.new_chat")} hitSlop={8} style={styles.headerButton} onPress={newThread}><Icon name="create-outline" size={21} color={theme.colors.textSecondary} /></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={t("oio_ai.history")} hitSlop={8} style={styles.headerButton} onPress={() => { haptic.light(); setHistoryOpen(true); }}><Icon name="chatbubble-ellipses-outline" size={21} color={theme.colors.textSecondary} /></Pressable>
        </View>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {turns.length ? <FlatList
          ref={listRef}
          data={turns}
          keyExtractor={(turn) => turn.id}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => item.role === "user"
            ? <View style={styles.userBubble}><Text style={styles.userText}>{item.text}</Text></View>
            : <AssistantTurn turn={item} onOpenCard={onOpenCard} savedCardId={cardId} savingCard={savingCard} onAction={(action) => {
              if (action.kind === "save_card") { void saveCard(); return; }
              if (action.kind === "thread_full") return;
              haptic.medium();
              onStartBlindBox(action.cardIds);
            }} />}
        /> : <ScrollView contentContainerStyle={styles.empty} keyboardShouldPersistTaps="handled">
          <OioMascot size={64} />
          {contextCard ? <Text style={styles.emptyTitle}>{tf("oio_ai.empty_card", { title: contextCard.title })}</Text>
            // OIO opens with a personal question; tap 换一个 for another.
            : <Reanimated.View key={opener?.greeting ?? "default"} entering={FadeIn.duration(motion.duration.enter)} style={styles.greetingRow}>
              <Text style={styles.emptyTitle}>{opener?.greeting ?? t("oio_ai.empty_title")}</Text>
            </Reanimated.View>}
          <Text style={styles.emptyCaption}>{t("oio_ai.empty_caption")}</Text>
          {contextCard ? null : <Pressable accessibilityRole="button" disabled={openerLoading} hitSlop={8} style={({ pressed }) => [styles.shuffle, pressed && { opacity: 0.6 }]} onPress={() => { haptic.select(); loadOpener(true); }}>
            {openerLoading ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : <Icon name="refresh-outline" size={14} color={theme.colors.textMuted} />}
            <Text style={styles.shuffleText}>{t("oio_ai.another_topic")}</Text>
          </Pressable>}
          <View style={styles.suggestions}>
            {(contextCard ? [t("oio_ai.suggest.card_where_else"), t("oio_ai.suggest.card_quiz")] : [...(opener?.topics.length ? opener.topics : FALLBACK_TOPICS.map((key) => t(key))), t("oio_ai.suggest.weak_words")]).map((label, index) => <Reanimated.View key={`${label}-${index}`} entering={FadeInDown.duration(motion.duration.enter).delay(index * motion.stagger)}>
              <Pressable accessibilityRole="button" style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: theme.colors.fill3 }]} onPress={() => void send(label)}>
                <Text style={styles.suggestionText}>{label}</Text>
                <Icon name="arrow-forward" size={16} color={theme.colors.textMuted} />
              </Pressable>
            </Reanimated.View>)}
          </View>
        </ScrollView>}
        {full ? <View style={styles.fullBar}>
          <Text style={styles.fullText}>{t("oio_ai.full")}</Text>
          <View style={styles.fullActions}>
            <Pressable accessibilityRole="button" disabled={savingCard} style={({ pressed }) => [styles.fullButton, styles.fullPrimary, pressed && { opacity: 0.85 }]} onPress={() => void saveCard()}>
              {savingCard ? <ActivityIndicator size="small" color={theme.colors.onAccent} /> : <Text style={styles.fullPrimaryText}>{t(cardId ? "oio_ai.saved_card" : "oio_ai.save_short")}</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.fullButton, pressed && { opacity: 0.7 }]} onPress={newThread}>
              <Text style={styles.fullSecondaryText}>{t("oio_ai.new_chat")}</Text>
            </Pressable>
          </View>
        </View> : <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("oio_ai.placeholder")}
            placeholderTextColor={theme.colors.textFaint}
            multiline
            maxLength={1000}
            style={styles.input}
            editable={!busy}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={t("oio_ai.send")} disabled={busy || !text.trim()} style={[styles.send, (busy || !text.trim()) && styles.sendOff]} onPress={() => void send(text)}>
            {busy ? <ActivityIndicator size="small" color={theme.colors.onAccent} /> : <Icon name="arrow-up" size={20} color={theme.colors.onAccent} />}
          </Pressable>
        </View>}
      </KeyboardAvoidingView>
      {historyOpen ? <HistorySheet onClose={() => setHistoryOpen(false)} onOpen={(thread) => void openThread(thread)} onDeleted={(id) => { if (id === threadId) newThread(); }} /> : null}
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}

function AssistantTurn({ turn, onOpenCard, onAction, savedCardId, savingCard }: { turn: Turn; onOpenCard: (recordId: string) => void; onAction: (action: OioAiAction) => void; savedCardId: string | null; savingCard: boolean }) {
  return <View style={styles.assistant}>
    {turn.text ? <Text selectable style={styles.assistantText}>{turn.text}</Text> : null}
    {turn.pending && !turn.text ? <View style={styles.thinking}>
      <ActivityIndicator size="small" color={theme.colors.textMuted} />
      <Text style={styles.thinkingText}>{t((turn.tool && TOOL_LABEL[turn.tool]) as "oio_ai.tool.search" ?? "oio_ai.thinking")}</Text>
    </View> : null}
    {turn.blocks.map((block, index) => block.type === "cards"
      ? <ScrollView key={index} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardRow}>
        {block.cards.map((card, cardIndex) => <CardTile key={card.recordId} card={card} index={cardIndex} onPress={() => { haptic.light(); onOpenCard(card.recordId); }} />)}
      </ScrollView>
      : block.action.kind === "thread_full"
        ? <Text key={index} style={styles.fullNote}>{block.action.label}</Text>
      : block.action.kind === "save_card"
        // 存成卡片 offer; once saved it becomes 已存为卡片 · 查看.
        ? <Reanimated.View key={index} entering={FadeIn.duration(motion.duration.quick)}>
          <Pressable accessibilityRole="button" disabled={savingCard} style={({ pressed }) => [styles.saveOffer, savedCardId && styles.saveOfferDone, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]} onPress={() => savedCardId ? onOpenCard(savedCardId) : onAction(block.action)}>
            {savingCard ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Icon name={savedCardId ? "checkmark-circle" : "albums-outline"} size={18} color={theme.colors.accent} />}
            <Text style={styles.saveOfferText}>{savedCardId ? t("oio_ai.saved_card") : savingCard ? t("oio_ai.saving_card") : block.action.label}</Text>
            {savedCardId ? <Icon name="chevron-forward" size={15} color={theme.colors.accent} /> : null}
          </Pressable>
        </Reanimated.View>
        : <Reanimated.View key={index} entering={FadeIn.duration(motion.duration.quick)}>
          <Pressable accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]} onPress={() => onAction(block.action)}>
            <Icon name="play-circle-outline" size={18} color={theme.colors.onAccent} />
            <Text style={styles.actionText}>{block.action.label}</Text>
          </Pressable>
        </Reanimated.View>)}
    {turn.error ? <Text style={styles.errorText}>{turn.error}</Text> : null}
  </View>;
}

function CardTile({ card, index, onPress }: { card: OioAiCard; index: number; onPress: () => void }) {
  const [year, month, day] = card.dateKey.split("-").map(Number);
  const thisYear = new Date().getFullYear() === year;
  const date = getLanguage().startsWith("zh") || getLanguage().startsWith("ja") ? `${thisYear ? "" : `${year}年`}${month}月${day}日` : `${month}/${day}${thisYear ? "" : `/${year}`}`;
  return <Reanimated.View entering={FadeInDown.duration(motion.duration.enter).delay(Math.min(index, motion.maxStaggered) * motion.stagger)}>
    <Pressable accessibilityRole="button" accessibilityLabel={card.title} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.88, transform: [{ scale: 0.97 }] }]} onPress={onPress}>
      {card.thumbnail
        ? <Image source={{ uri: card.thumbnail.url }} style={styles.tileCover} resizeMode="cover" />
        : <View style={[styles.tileCover, styles.tileTextCover, { backgroundColor: coverFillFor(card.recordId) }]}><Text numberOfLines={4} style={styles.tileQuote}>{card.preview}</Text></View>}
      <Text numberOfLines={2} style={styles.tileTitle}>{card.title}</Text>
      <Text style={styles.tileDate}>{date}</Text>
    </Pressable>
  </Reanimated.View>;
}

function HistorySheet({ onClose, onOpen, onDeleted }: { onClose: () => void; onOpen: (thread: OioAiThread) => void; onDeleted: (threadId: string) => void }) {
  const [threads, setThreads] = useState<OioAiThread[] | null>(null);
  useEffect(() => { void listOioAiThreads().then(setThreads).catch(() => setThreads([])); }, []);
  // Long-press a conversation to delete it (a card saved from it stays).
  const confirmDelete = (thread: OioAiThread) => {
    haptic.medium();
    Alert.alert(t("oio_ai.delete_title"), t(thread.cardId ? "oio_ai.delete_message_saved" : "oio_ai.delete_message"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => {
        setThreads((current) => current?.filter((item) => item.id !== thread.id) ?? current);
        onDeleted(thread.id);
        void deleteOioAiThread(thread.id).catch(() => { haptic.warning(); void listOioAiThreads().then(setThreads).catch(() => undefined); });
      } },
    ]);
  };
  return <Pressable style={styles.sheetBackdrop} onPress={onClose}>
    <Pressable style={styles.sheet} onPress={() => undefined}>
      <View style={styles.sheetHandle} />
      <Text style={styles.sheetTitle}>{t("oio_ai.history")}</Text>
      {threads?.length ? <Text style={styles.sheetHint}>{t("oio_ai.history_hint")}</Text> : null}
      {threads === null ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.colors.textMuted} />
        : !threads.length ? <Text style={styles.sheetEmpty}>{t("oio_ai.history_empty")}</Text>
          : <ScrollView style={{ maxHeight: 420 }}>{threads.map((thread) => <Pressable key={thread.id} accessibilityRole="button" style={({ pressed }) => [styles.threadRow, pressed && { backgroundColor: theme.colors.fill1 }]} onPress={() => { haptic.light(); onOpen(thread); }} onLongPress={() => confirmDelete(thread)} delayLongPress={350}>
            <Text numberOfLines={1} style={styles.threadTitle}>{thread.title || t("oio_ai.untitled")}</Text>
            <Text style={styles.threadDate}>{thread.updatedAt.slice(5, 10).replace("-", "/")}</Text>
          </Pressable>)}</ScrollView>}
    </Pressable>
  </Pressable>;
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: theme.colors.canvas },
  header: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  headerActions: { flexDirection: "row", alignItems: "center", minWidth: 44, justifyContent: "flex-end" },
  title: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  empty: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingBottom: 40, gap: 8 },
  emptyTitle: { marginTop: 10, color: theme.colors.text, fontSize: 19, fontWeight: "700", textAlign: "center" },
  emptyCaption: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  suggestions: { alignSelf: "stretch", marginTop: 18, gap: 8 },
  suggestion: { minHeight: 48, borderRadius: 12, backgroundColor: theme.colors.fill1, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  suggestionText: { flex: 1, color: theme.colors.text, fontSize: 15 },
  thread: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20, gap: 14 },
  userBubble: { alignSelf: "flex-end", maxWidth: "82%", borderRadius: 16, borderBottomRightRadius: 6, backgroundColor: theme.colors.fill2, paddingHorizontal: 14, paddingVertical: 10 },
  userText: { color: theme.colors.text, fontSize: 15, lineHeight: 22 },
  assistant: { gap: 10 },
  assistantText: { color: theme.colors.text, fontSize: 16, lineHeight: 25 },
  thinking: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  thinkingText: { color: theme.colors.textMuted, fontSize: 14 },
  cardRow: { gap: 10, paddingRight: 16 },
  tile: { width: 132, gap: 4 },
  tileCover: { width: 132, height: 132, borderRadius: 10, backgroundColor: theme.colors.fill2 },
  tileTextCover: { padding: 10, justifyContent: "flex-start" },
  tileQuote: { color: theme.colors.textStrong, fontSize: 12, lineHeight: 17 },
  tileTitle: { color: theme.colors.text, fontSize: 13, lineHeight: 18, fontWeight: "500" },
  tileDate: { color: theme.colors.textMuted, fontSize: 11 },
  action: { alignSelf: "flex-start", minHeight: 44, borderRadius: 22, backgroundColor: theme.colors.accent, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: "700" },
  greetingRow: { alignItems: "center" },
  shuffle: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingHorizontal: 10 },
  shuffleText: { color: theme.colors.textMuted, fontSize: 13 },
  fullNote: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, backgroundColor: theme.colors.fill1, borderRadius: 10, padding: 10 },
  fullBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 10, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.canvas },
  fullText: { color: theme.colors.textSecondary, fontSize: 14, textAlign: "center" },
  fullActions: { flexDirection: "row", gap: 10 },
  fullButton: { flex: 1, minHeight: 44, borderRadius: 22, backgroundColor: theme.colors.fill2, alignItems: "center", justifyContent: "center" },
  fullPrimary: { backgroundColor: theme.colors.accent },
  fullPrimaryText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: "700" },
  fullSecondaryText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  saveOffer: { alignSelf: "flex-start", minHeight: 44, borderRadius: 22, backgroundColor: theme.colors.accentSoft, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 6 },
  saveOfferDone: { backgroundColor: theme.colors.fill1 },
  saveOfferText: { color: theme.colors.accent, fontSize: 15, fontWeight: "700" },
  saveChip: { minHeight: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: theme.colors.accentSoft, flexDirection: "row", alignItems: "center", gap: 4, marginRight: 2 },
  saveChipDone: { backgroundColor: theme.colors.fill1 },
  saveChipText: { color: theme.colors.accent, fontSize: 13, fontWeight: "700" },
  errorText: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, backgroundColor: theme.colors.fill1, borderRadius: 10, padding: 10 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.canvas },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, backgroundColor: theme.colors.fill1, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, color: theme.colors.text, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  sendOff: { opacity: 0.4 },
  sheetBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end", backgroundColor: theme.colors.scrim },
  sheet: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: theme.colors.surface, gap: 8 },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.fill3 },
  sheetTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700", paddingHorizontal: 4, paddingVertical: 4 },
  sheetHint: { color: theme.colors.textMuted, fontSize: 12, paddingHorizontal: 4, marginTop: -6 },
  sheetEmpty: { color: theme.colors.textMuted, fontSize: 14, paddingHorizontal: 4, paddingVertical: 16 },
  threadRow: { minHeight: 52, borderRadius: 10, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  threadTitle: { flex: 1, color: theme.colors.text, fontSize: 15 },
  threadDate: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
}));
