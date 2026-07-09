import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ChatMessage } from "../../domain/chat/types";
import type { ChatContact } from "../../domain/chat/contacts";
import { normalizeClozeState, tokenizeForCloze } from "../../domain/cloze/clozeUtils";
import { getAssistantClozeText } from "../../domain/cloze/clozeText";
import { t } from "../../i18n";
import type { NativeTextSelectionPayload } from "./SelectableMessageText";

export type ClozeEditorState = {
  message: ChatMessage;
  groupIndex: number | null;
  tokenIndexes: number[];
  draftBlankIndexes: number[];
};

export type ClozeDeleteState = {
  message: ChatMessage;
  groupIndex: number;
};

type ClozeControlsProps = {
  contact: ChatContact;
  editor: ClozeEditorState | null;
  deleteTarget: ClozeDeleteState | null;
  onCloseEditor: () => void;
  onToggleDraftToken: (tokenIndex: number) => void;
  onConfirmEditor: () => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  onEditDeleteTarget?: (message: ChatMessage, groupIndex: number) => void;
  onLookupDeleteTarget?: (message: ChatMessage, payload: NativeTextSelectionPayload) => void;
};

export function ClozeControls({
  contact,
  editor,
  deleteTarget,
  onCloseEditor,
  onToggleDraftToken,
  onConfirmEditor,
  onCloseDelete,
  onConfirmDelete,
  onEditDeleteTarget,
  onLookupDeleteTarget,
}: ClozeControlsProps) {
  const lastEditorRef = React.useRef<ClozeEditorState | null>(null);
  if (editor) {
    lastEditorRef.current = editor;
  }
  const visibleEditor = editor ?? lastEditorRef.current;
  const editorTokens = visibleEditor
    ? tokenizeForCloze(getAssistantClozeText(visibleEditor.message, contact).text).filter((token) =>
        visibleEditor.tokenIndexes.includes(token.index)
      )
    : [];
  const deleteLookup = React.useMemo(() => {
    if (!deleteTarget || !onLookupDeleteTarget) return null;
    const text = getAssistantClozeText(deleteTarget.message, contact).text;
    const group = normalizeClozeState(deleteTarget.message.clozeState)?.groups[deleteTarget.groupIndex];
    if (!group) return null;
    const lookupIndexes = group.blankTokenIndexes.length ? group.blankTokenIndexes : group.tokenIndexes;
    const lookupSet = new Set(lookupIndexes);
    const tokens = tokenizeForCloze(text).filter((token) => lookupSet.has(token.index));
    if (!tokens.length) return null;
    const start = tokens[0].start;
    const end = tokens[tokens.length - 1].end;
    const selectedText = text.slice(start, end);
    if (!selectedText.trim()) return null;
    return {
      message: { ...deleteTarget.message, text },
      payload: {
        start,
        end,
        selectedText,
      },
    };
  }, [contact, deleteTarget, onLookupDeleteTarget]);

  return (
    <>
      <Modal visible={!!editor} transparent animationType="fade" onRequestClose={onCloseEditor}>
        <View style={styles.editorScrim}>
          <View style={styles.editorCard}>
            <Text style={styles.editorTitle}>{t("cloze.edit")}</Text>
            <ScrollView style={styles.editorScroll} contentContainerStyle={styles.editorTokens}>
              {editorTokens.map((token) => {
                const active = visibleEditor?.draftBlankIndexes.includes(token.index) ?? false;

                return (
                  <Pressable
                    key={token.index}
                    style={[styles.editorToken, active && styles.editorTokenActive]}
                    onPress={() => onToggleDraftToken(token.index)}
                  >
                    <Text style={[styles.editorTokenText, active && styles.editorTokenTextActive]}>
                      {token.text}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.editorActions}>
              <Pressable style={styles.editorCancel} onPress={onCloseEditor}>
                <Text style={styles.editorCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable style={styles.editorConfirm} onPress={onConfirmEditor}>
                <Text style={styles.editorConfirmText}>{t("common.confirm")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={onCloseDelete}>
        <Pressable style={styles.selectionOverlay} onPress={onCloseDelete}>
          <View style={styles.deleteClozeDock}>
            {deleteLookup ? (
              <Pressable
                style={styles.lookupClozeButton}
                onPress={() => {
                  onCloseDelete();
                  onLookupDeleteTarget?.(deleteLookup.message, deleteLookup.payload);
                }}
              >
                <Text style={styles.lookupClozeText}>{t("dictionary.menu")}</Text>
              </Pressable>
            ) : null}
            {deleteTarget && onEditDeleteTarget ? (
              <Pressable
                style={styles.editClozeButton}
                onPress={() => {
                  const target = deleteTarget;
                  onCloseDelete();
                  onEditDeleteTarget(target.message, target.groupIndex);
                }}
              >
                <Text style={styles.editClozeText}>{t("cloze.edit")}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.deleteClozeButton} onPress={onConfirmDelete}>
              <Text style={styles.deleteClozeText}>{t("cloze.delete")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  selectionOverlay: {
    flex: 1,
  },
  deleteClozeDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: "center",
    gap: 10,
  },
  lookupClozeButton: {
    minHeight: 40,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9DDF0",
    alignItems: "center",
    justifyContent: "center",
  },
  lookupClozeText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "800",
  },
  editClozeButton: {
    minHeight: 40,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: "#F1F3F7",
    alignItems: "center",
    justifyContent: "center",
  },
  editClozeText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "800",
  },
  deleteClozeButton: {
    minHeight: 40,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteClozeText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  editorScrim: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  editorCard: {
    width: "100%",
    maxHeight: "72%",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 16,
  },
  editorTitle: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 16,
  },
  editorScroll: {
    maxHeight: 320,
  },
  editorTokens: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 12,
  },
  editorToken: {
    minHeight: 34,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#D9DDF0",
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  editorTokenActive: {
    borderColor: "#8E7BFF",
    backgroundColor: "#F0EDFF",
  },
  editorTokenText: {
    color: "#111111",
    fontSize: 15,
  },
  editorTokenTextActive: {
    color: "#5A47D8",
    fontWeight: "700",
  },
  editorActions: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  editorCancel: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#F1F3F7",
    alignItems: "center",
    justifyContent: "center",
  },
  editorCancelText: {
    color: "#515866",
    fontSize: 15,
    fontWeight: "700",
  },
  editorConfirm: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#8E7BFF",
    alignItems: "center",
    justifyContent: "center",
  },
  editorConfirmText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
});
