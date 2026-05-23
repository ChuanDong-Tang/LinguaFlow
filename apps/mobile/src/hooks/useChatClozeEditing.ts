import React, { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
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
import type { ClozeDeleteState, ClozeEditorState } from "../screens/chat/ClozeControls";
import type { InfoDialogConfig } from "../screens/shared/InfoDialog";

type ChatNotice = {
  hide: () => void;
  update: (next: Partial<FloatingNoticeOptions>) => void;
  kind: "calendar" | "messages" | "cloze";
};

type UseChatClozeEditingInput = {
  contact: ChatContact;
  contactId: string;
  dayMessages: ChatMessage[];
  isSelectedDateSyncing: boolean;
  isProEntitledRef: MutableRefObject<boolean>;
  syncNoticeRef: MutableRefObject<ChatNotice | null>;
  setDayMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setLocalDateKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  setIsProEntitled: React.Dispatch<React.SetStateAction<boolean>>;
  setDialog: React.Dispatch<React.SetStateAction<InfoDialogConfig | null>>;
  showNotice: (options: FloatingNoticeOptions) => Omit<ChatNotice, "kind">;
  runHistoryLoading: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T>;
};

export function useChatClozeEditing({
  contact,
  contactId,
  dayMessages,
  isSelectedDateSyncing,
  isProEntitledRef,
  syncNoticeRef,
  setDayMessages,
  setMessages,
  setLocalDateKeys,
  setIsProEntitled,
  setDialog,
  showNotice,
  runHistoryLoading,
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
    const target = clozeDelete;
    setClozeDelete(null);
    await runHistoryLoading(() =>
      saveMessageCloze(target.message, removeClozeGroup(target.message.clozeState, target.groupIndex))
    );
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
    const nextState = replaceClozeGroup(
      clozeEditor.message.clozeState,
      clozeEditor.groupIndex,
      clozeEditor.tokenIndexes,
      clozeEditor.draftBlankIndexes,
    );
    const target = clozeEditor.message;
    setClozeEditor(null);
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
    try {
      await saveMessageCloze(target, nextState);
      notice.update({ message: "已保存", type: "success", durationMs: 1200 });
    } catch (error) {
      notice.update({ message: "保存失败", type: "warning", durationMs: 1800 });
      setDialog({ message: "保存填空失败，请稍后重试。" });
    } finally {
      if (syncNoticeRef.current === notice) {
        syncNoticeRef.current = null;
      }
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
