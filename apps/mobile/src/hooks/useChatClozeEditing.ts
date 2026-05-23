import React, { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import type { FloatingNoticeOptions } from "../screens/shared/FloatingNotice";
import type { ChatContact } from "../domain/chat/contacts";
import type { ChatMessage } from "../domain/chat/types";
import type { NativeTextSelectionPayload } from "../screens/chat/SelectableMessageText";
import {
  expandSelectionToTokenRange,
  normalizeClozeState,
  removeClozeGroup,
  replaceClozeGroup,
} from "../domain/cloze/clozeUtils";
import { getAssistantClozeText } from "../domain/cloze/clozeText";
import { getMessageDateKey } from "../domain/chat/messageState";
import { hasLocalProAccess } from "../services/entitlement/proAccess";
import { updateMessageClozeState } from "../services/api/chatHistoryApi";
import {
  loadChatMessagesByDate,
  replaceChatMessagesByDate,
} from "../services/chat/chatSessionService";
import { isSameChatMessage } from "../services/chat/chatMessageView";
import { markPracticeStatsDirty } from "../services/chat/chatPracticeSyncState";
import type { ClozeDeleteState, ClozeEditorState } from "../screens/chat/ClozeControls";
import type { InfoDialogConfig } from "../screens/shared/InfoDialog";

type ChatNotice = {
  hide: () => void;
  update: (next: Partial<FloatingNoticeOptions>) => void;
  kind: "calendar" | "messages" | "cloze";
};

type MutableRef<T> = {
  current: T;
};

type SyncMachineLike = {
  begin: (kind: "cloze_save", scopeKey: string) => { token: number; controller: AbortController };
  setPhase: (token: number, phase: "checking" | "fetching" | "merging" | "settling") => void;
  settle: (token: number) => void;
};

type UseChatClozeEditingInput = {
  contact: ChatContact;
  contactId: string;
  dayMessages: ChatMessage[];
  isSelectedDateSyncing: boolean;
  isProEntitledRef: MutableRef<boolean>;
  syncNoticeRef: MutableRef<ChatNotice | null>;
  syncMachine: SyncMachineLike;
  setDayMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setLocalDateKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  setIsProEntitled: React.Dispatch<React.SetStateAction<boolean>>;
  setDialog: React.Dispatch<React.SetStateAction<InfoDialogConfig | null>>;
  showNotice: (options: FloatingNoticeOptions) => Omit<ChatNotice, "kind">;
};

export function useChatClozeEditing({
  contact,
  contactId,
  dayMessages,
  isSelectedDateSyncing,
  isProEntitledRef,
  syncNoticeRef,
  syncMachine,
  setDayMessages,
  setMessages,
  setLocalDateKeys,
  setIsProEntitled,
  setDialog,
  showNotice,
}: UseChatClozeEditingInput): {
  clozeEditor: ClozeEditorState | null;
  clozeDelete: ClozeDeleteState | null;
  setClozeEditor: React.Dispatch<React.SetStateAction<ClozeEditorState | null>>;
  setClozeDelete: React.Dispatch<React.SetStateAction<ClozeDeleteState | null>>;
  handleTextSelection: (
    message: ChatMessage,
    payload: NativeTextSelectionPayload,
    clearSelection: () => void
  ) => void;
  handleEditClozeGroup: (message: ChatMessage, groupIndex: number) => void;
  handleDeleteClozeGroup: (message: ChatMessage, groupIndex: number) => void;
  confirmDeleteCloze: () => Promise<void>;
  toggleDraftToken: (tokenIndex: number) => void;
  confirmClozeEditor: () => Promise<void>;
} {
  const [clozeEditor, setClozeEditor] = useState<ClozeEditorState | null>(null);
  const [clozeDelete, setClozeDelete] = useState<ClozeDeleteState | null>(null);
  const clozeSaveQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const clozeMutatingRef = useRef(false);

  const blockClozeWhenSelectedDateSyncing = useCallback((): boolean => {
    return isSelectedDateSyncing;
  }, [isSelectedDateSyncing]);

  const applyMessageUpdate = useCallback(
    async (nextMessage: ChatMessage): Promise<void> => {
      const replace = (rows: ChatMessage[]) =>
        rows.map((row) => (isSameChatMessage(row, nextMessage) ? nextMessage : row));
      const dayKey = getMessageDateKey(nextMessage);
      const currentDay = await loadChatMessagesByDate(contactId, dayKey);
      const nextDayFromStorage = replace(currentDay);
      await replaceChatMessagesByDate(contactId, dayKey, nextDayFromStorage);
      markPracticeStatsDirty(dayKey);
      const nextDay = replace(dayMessages);
      setDayMessages(nextDay);
      setMessages(nextDay);
      setLocalDateKeys((prev) => new Set([...prev, dayKey]));
    },
    [contactId, dayMessages, setDayMessages, setLocalDateKeys, setMessages],
  );

  const persistMessageCloze = useCallback(
    async (message: ChatMessage, clozeState: ChatMessage["clozeState"]): Promise<void> => {
      const matches = (row: ChatMessage) => isSameChatMessage(row, message);
      const currentDay = await loadChatMessagesByDate(contactId, getMessageDateKey(message));
      const currentMessage = currentDay.find(matches) ?? message;
      const baseVersion = currentMessage.clozeVersion ?? 0;
      const optimistic = { ...currentMessage, clozeState, clozeVersion: baseVersion + 1 };
      await applyMessageUpdate(optimistic);

      if (currentMessage.id) {
        const isPro = await hasLocalProAccess();
        isProEntitledRef.current = isPro;
        setIsProEntitled(isPro);
      }

      if (!isProEntitledRef.current || !currentMessage.id) {
        return;
      }

      try {
        const saved = await updateMessageClozeState({
          messageId: currentMessage.id,
          baseVersion,
          clozeState,
        });
        await applyMessageUpdate({
          ...optimistic,
          clozeState: saved.clozeState ?? null,
          clozeVersion: saved.clozeVersion,
        });
      } catch (error) {
        const latest = (error as { latest?: { clozeState: ChatMessage["clozeState"]; clozeVersion: number } }).latest;
        if (latest) {
          await applyMessageUpdate({
            ...currentMessage,
            clozeState: latest.clozeState ?? null,
            clozeVersion: latest.clozeVersion,
          });
          return;
        }
        await applyMessageUpdate(currentMessage);
        throw error;
      }
    },
    [applyMessageUpdate, contactId, isProEntitledRef, setIsProEntitled],
  );

  const saveMessageCloze = useCallback(
    async (message: ChatMessage, clozeState: ChatMessage["clozeState"]): Promise<void> => {
      const key = message.id ?? message.localId;
      const previous = clozeSaveQueueRef.current.get(key) ?? Promise.resolve();
      const queued = previous
        .catch(() => undefined)
        .then(() => persistMessageCloze(message, clozeState));
      clozeSaveQueueRef.current.set(key, queued);
      try {
        await queued;
      } finally {
        if (clozeSaveQueueRef.current.get(key) === queued) {
          clozeSaveQueueRef.current.delete(key);
        }
      }
    },
    [persistMessageCloze],
  );

  const handleTextSelection = useCallback(
    (message: ChatMessage, payload: NativeTextSelectionPayload, clearSelection: () => void) => {
      if (blockClozeWhenSelectedDateSyncing()) {
        clearSelection();
        return;
      }
      if (payload.start === payload.end) {
        return;
      }
      const expanded = expandSelectionToTokenRange(
        getAssistantClozeText(message, contact).text,
        payload.start,
        payload.end,
        message.clozeState,
      );
      if (!expanded) {
        return;
      }
      clearSelection();
      setClozeEditor({
        message,
        groupIndex: null,
        tokenIndexes: expanded.tokenIndexes,
        draftBlankIndexes: [],
      });
    },
    [blockClozeWhenSelectedDateSyncing, contact],
  );

  const handleEditClozeGroup = useCallback(
    (message: ChatMessage, groupIndex: number) => {
      if (blockClozeWhenSelectedDateSyncing()) return;
      const group = normalizeClozeState(message.clozeState)?.groups[groupIndex];
      if (!group) return;
      setClozeEditor({
        message,
        groupIndex,
        tokenIndexes: group.tokenIndexes,
        draftBlankIndexes: group.blankTokenIndexes,
      });
    },
    [blockClozeWhenSelectedDateSyncing],
  );

  const handleDeleteClozeGroup = useCallback(
    (message: ChatMessage, groupIndex: number) => {
      if (blockClozeWhenSelectedDateSyncing()) return;
      setClozeDelete({ message, groupIndex });
    },
    [blockClozeWhenSelectedDateSyncing],
  );

  async function confirmDeleteCloze(): Promise<void> {
    if (!clozeDelete) return;
    if (clozeMutatingRef.current) {
      Alert.alert("正在处理填空，请稍后再试");
      return;
    }
    const target = clozeDelete;
    setClozeDelete(null);
    const key = target.message.id ?? target.message.localId;
    const { token } = syncMachine.begin("cloze_save", key);
    syncNoticeRef.current?.hide();
    const notice = {
      kind: "cloze" as const,
      ...showNotice({
        message: "正在删除填空...",
        type: "info",
        position: "top-right",
        durationMs: 0,
      }),
    };
    syncNoticeRef.current = notice;
    clozeMutatingRef.current = true;
    try {
      syncMachine.setPhase(token, "fetching");
      await saveMessageCloze(target.message, removeClozeGroup(target.message.clozeState, target.groupIndex));
      syncMachine.setPhase(token, "settling");
      notice.hide();
    } catch (error) {
      notice.update({ message: "删除失败", type: "warning", durationMs: 1800 });
      setDialog({ message: "删除填空失败，请稍后重试。" });
    } finally {
      if (syncNoticeRef.current === notice) {
        syncNoticeRef.current = null;
      }
      clozeMutatingRef.current = false;
      syncMachine.settle(token);
    }
  }

  function toggleDraftToken(tokenIndex: number): void {
    setClozeEditor((current) => {
      if (!current) return current;
      const set = new Set(current.draftBlankIndexes);
      if (set.has(tokenIndex)) set.delete(tokenIndex);
      else set.add(tokenIndex);
      return { ...current, draftBlankIndexes: Array.from(set).sort((a, b) => a - b) };
    });
  }

  async function confirmClozeEditor(): Promise<void> {
    if (!clozeEditor) return;
    if (clozeMutatingRef.current) {
      Alert.alert("正在处理填空，请稍后再试");
      return;
    }
    const nextState = replaceClozeGroup(
      clozeEditor.message.clozeState,
      clozeEditor.groupIndex,
      clozeEditor.tokenIndexes,
      clozeEditor.draftBlankIndexes,
    );
    const target = clozeEditor.message;
    setClozeEditor(null);
    const key = target.id ?? target.localId;
    const { token } = syncMachine.begin("cloze_save", key);
    syncNoticeRef.current?.hide();
    const notice = {
      kind: "cloze" as const,
      ...showNotice({
        message: "正在保存...",
        type: "info",
        position: "top-right",
        durationMs: 0,
      }),
    };
    syncNoticeRef.current = notice;
    clozeMutatingRef.current = true;
    try {
      syncMachine.setPhase(token, "fetching");
      await saveMessageCloze(target, nextState);
      syncMachine.setPhase(token, "settling");
      notice.hide();
    } catch (error) {
      notice.update({ message: "保存失败", type: "warning", durationMs: 1800 });
      setDialog({ message: "保存填空失败，请稍后重试。" });
    } finally {
      if (syncNoticeRef.current === notice) {
        syncNoticeRef.current = null;
      }
      clozeMutatingRef.current = false;
      syncMachine.settle(token);
    }
  }

  return {
    clozeEditor,
    clozeDelete,
    setClozeEditor,
    setClozeDelete,
    handleTextSelection,
    handleEditClozeGroup,
    handleDeleteClozeGroup,
    confirmDeleteCloze,
    toggleDraftToken,
    confirmClozeEditor,
  };
}
