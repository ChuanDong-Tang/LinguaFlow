import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
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
import {
  listOioAiMessages, listOioAiThreads, OioAiError, streamOioAi,
  type OioAiAction, type OioAiBlock, type OioAiCard, type OioAiThread,
} from "../../services/ai/oioAiApi";

type Turn = { id: string; role: "user" | "assistant"; text: string; blocks: OioAiBlock[]; tool?: string | null; pending?: boolean; error?: string | null };

const SUGGESTIONS = ["oio_ai.suggest.last_week_photos", "oio_ai.suggest.weak_words", "oio_ai.suggest.this_time_last_year", "oio_ai.suggest.where_did_i_write"] as const;
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
  const listRef = useRef<FlatList<Turn>>(null);
  const abortRef = useRef<AbortController | null>(null);
  useAndroidBack(visible && historyOpen, () => setHistoryOpen(false));
  useEffect(() => () => abortRef.current?.abort(), []);
  // A new card context starts a new conversation.
  useEffect(() => { if (visible && contextCard) { setThreadId(null); setTurns([]); } }, [contextCard, visible]);

  const send = useCallback(async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    haptic.light();
    setText("");
    setBusy(true);
    const assistantId = `a-${Date.now()}`;
    setTurns((current) => [...current, { id: `u-${Date.now()}`, role: "user", text: message, blocks: [] }, { id: assistantId, role: "assistant", text: "", blocks: [], pending: true }]);
    const update = (change: (turn: Turn) => Turn) => setTurns((current) => current.map((turn) => turn.id === assistantId ? change(turn) : turn));
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamOioAi({ text: message, threadId, contextCardId: threadId ? null : contextCard?.recordId, appLocale: getLanguage(), signal: abort.signal }, (event) => {
        if (event.type === "thread") setThreadId(event.threadId);
        else if (event.type === "delta") update((turn) => ({ ...turn, text: turn.text + event.text, tool: null }));
        else if (event.type === "tool") update((turn) => ({ ...turn, tool: event.name }));
        else if (event.type === "cards") update((turn) => ({ ...turn, blocks: [...turn.blocks, { type: "cards", cards: event.cards }] }));
        else if (event.type === "action") update((turn) => ({ ...turn, blocks: [...turn.blocks, { type: "action", action: event.action }] }));
      });
      update((turn) => ({ ...turn, pending: false, tool: null }));
    } catch (error) {
      const code = error instanceof OioAiError ? error.code : "NETWORK_ERROR";
      if (code !== "ABORTED") haptic.warning();
      update((turn) => ({ ...turn, pending: false, tool: null, error: code === "ABORTED" ? null : errorText(code) }));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [busy, contextCard, threadId]);

  const openThread = async (thread: OioAiThread) => {
    setHistoryOpen(false);
    abortRef.current?.abort();
    setThreadId(thread.id);
    setTurns([]);
    try {
      const messages = await listOioAiMessages(thread.id);
      setTurns(messages.map((message) => ({ id: message.id, role: message.role, text: message.text, blocks: message.blocks ?? [] })));
    } catch {
      setTurns([{ id: "load-error", role: "assistant", text: "", blocks: [], error: t("oio_ai.error.generic") }]);
    }
  };
  const newThread = () => { haptic.select(); abortRef.current?.abort(); setThreadId(null); setTurns([]); };

  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={historyOpen ? () => setHistoryOpen(false) : onClose}>
    <SafeAreaProvider><SafeAreaView style={styles.page} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8} style={styles.headerButton} onPress={onClose}><Icon name="close-outline" size={24} color={theme.colors.text} /></Pressable>
        <View style={styles.headerTitle}><OioMascot size={22} idle={false} /><Text style={styles.title}>OIO AI</Text></View>
        <View style={styles.headerActions}>
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
            : <AssistantTurn turn={item} onOpenCard={onOpenCard} onAction={(action) => { haptic.medium(); onStartBlindBox(action.cardIds); }} />}
        /> : <ScrollView contentContainerStyle={styles.empty} keyboardShouldPersistTaps="handled">
          <OioMascot size={64} />
          <Text style={styles.emptyTitle}>{contextCard ? tf("oio_ai.empty_card", { title: contextCard.title }) : t("oio_ai.empty_title")}</Text>
          <Text style={styles.emptyCaption}>{t("oio_ai.empty_caption")}</Text>
          <View style={styles.suggestions}>
            {(contextCard ? ["oio_ai.suggest.card_where_else", "oio_ai.suggest.card_quiz"] as const : SUGGESTIONS).map((key, index) => <Reanimated.View key={key} entering={FadeInDown.duration(motion.duration.enter).delay(index * motion.stagger)}>
              <Pressable accessibilityRole="button" style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: theme.colors.fill3 }]} onPress={() => void send(t(key))}>
                <Text style={styles.suggestionText}>{t(key)}</Text>
                <Icon name="arrow-forward" size={16} color={theme.colors.textMuted} />
              </Pressable>
            </Reanimated.View>)}
          </View>
        </ScrollView>}
        <View style={styles.composer}>
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
        </View>
      </KeyboardAvoidingView>
      {historyOpen ? <HistorySheet onClose={() => setHistoryOpen(false)} onOpen={(thread) => void openThread(thread)} /> : null}
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}

function AssistantTurn({ turn, onOpenCard, onAction }: { turn: Turn; onOpenCard: (recordId: string) => void; onAction: (action: OioAiAction) => void }) {
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

function HistorySheet({ onClose, onOpen }: { onClose: () => void; onOpen: (thread: OioAiThread) => void }) {
  const [threads, setThreads] = useState<OioAiThread[] | null>(null);
  useEffect(() => { void listOioAiThreads().then(setThreads).catch(() => setThreads([])); }, []);
  return <Pressable style={styles.sheetBackdrop} onPress={onClose}>
    <Pressable style={styles.sheet} onPress={() => undefined}>
      <View style={styles.sheetHandle} />
      <Text style={styles.sheetTitle}>{t("oio_ai.history")}</Text>
      {threads === null ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.colors.textMuted} />
        : !threads.length ? <Text style={styles.sheetEmpty}>{t("oio_ai.history_empty")}</Text>
          : <ScrollView style={{ maxHeight: 420 }}>{threads.map((thread) => <Pressable key={thread.id} accessibilityRole="button" style={({ pressed }) => [styles.threadRow, pressed && { backgroundColor: theme.colors.fill1 }]} onPress={() => { haptic.light(); onOpen(thread); }}>
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
  headerActions: { flexDirection: "row", minWidth: 44, justifyContent: "flex-end" },
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
  errorText: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, backgroundColor: theme.colors.fill1, borderRadius: 10, padding: 10 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.canvas },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, backgroundColor: theme.colors.fill1, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, color: theme.colors.text, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  sendOff: { opacity: 0.4 },
  sheetBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end", backgroundColor: theme.colors.scrim },
  sheet: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: theme.colors.surface, gap: 8 },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.fill3 },
  sheetTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700", paddingHorizontal: 4, paddingVertical: 4 },
  sheetEmpty: { color: theme.colors.textMuted, fontSize: 14, paddingHorizontal: 4, paddingVertical: 16 },
  threadRow: { minHeight: 52, borderRadius: 10, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  threadTitle: { flex: 1, color: theme.colors.text, fontSize: 15 },
  threadDate: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
}));
