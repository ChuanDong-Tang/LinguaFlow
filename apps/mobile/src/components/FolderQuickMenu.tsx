import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import Reanimated, { FadeInDown } from "react-native-reanimated";
import { Text, TextInput } from "./Typography";
import { Icon } from "./Icon";
import { CheckMark } from "./surface/Surface";
import { haptic } from "../feedback/haptics";
import { t } from "../i18n";
import { theme } from "../theme";
import { createStyles } from "../styles";
import type { CardCollection } from "../services/api/cardApi";
import { collectionPathName } from "../screens/shared/CollectionPickerModal";

/**
 * Lightweight folder chooser for the composer's # tag (2026-11): pops up above
 * the toolbar like a WeChat menu — 新建文件夹 first, then existing folders.
 * Managing folders (rename / delete) stays in the sidebar.
 */
export function FolderQuickMenu({ visible, collections, value, bottomOffset = 72, onClose, onSelect, onCreateCollection }: {
  visible: boolean;
  collections: CardCollection[];
  value: string | null | undefined;
  /** Distance from the screen bottom to the menu's bottom edge (sits above the toolbar). */
  bottomOffset?: number;
  onClose: () => void;
  onSelect: (collectionId: string | null) => void;
  onCreateCollection?: (name: string, parentId: string | null) => Promise<CardCollection>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!visible) { setCreating(false); setName(""); } }, [visible]);
  const choose = (collectionId: string | null) => { haptic.select(); onSelect(collectionId); onClose(); };
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || !onCreateCollection || saving) return;
    setSaving(true);
    try {
      const created = await onCreateCollection(trimmed, null);
      choose(created.id);
    } finally { setSaving(false); }
  };
  const sorted = [...collections].sort((a, b) => collectionPathName(a, collections).localeCompare(collectionPathName(b, collections)));
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Reanimated.View entering={FadeInDown.duration(180)} style={[styles.panel, { bottom: bottomOffset }]}>
        <Pressable onPress={() => undefined}>
          {onCreateCollection ? creating
            ? <View style={styles.createRow}>
              <TextInput autoFocus value={name} onChangeText={setName} placeholder={t("folder_menu.new_placeholder")} placeholderTextColor={theme.colors.textMuted} style={styles.createInput} returnKeyType="done" onSubmitEditing={() => void create()} maxLength={40} />
              <Pressable accessibilityRole="button" disabled={!name.trim() || saving} hitSlop={6} style={[styles.createDone, !name.trim() && { opacity: 0.4 }]} onPress={() => void create()}>
                {saving ? <ActivityIndicator size="small" color={theme.colors.onAccent} /> : <Text style={styles.createDoneText}>{t("folder_menu.done")}</Text>}
              </Pressable>
            </View>
            : <Pressable accessibilityRole="button" style={({ pressed }) => [styles.item, pressed && styles.pressed]} onPress={() => { haptic.light(); setCreating(true); }}>
              <Icon name="add" size={18} color={theme.colors.accent} />
              <Text style={[styles.itemText, { color: theme.colors.accent, fontWeight: "700" }]}>{t("folder_menu.new")}</Text>
            </Pressable> : null}
          <View style={styles.divider} />
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            <Row label={t("sidebar.unclassified")} selected={!value} onPress={() => choose(null)} />
            {sorted.map((collection) => <Row key={collection.id} label={collectionPathName(collection, collections)} selected={value === collection.id} onPress={() => choose(collection.id)} />)}
          </ScrollView>
        </Pressable>
      </Reanimated.View>
    </Pressable>
  </Modal>;
}

function Row({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} style={({ pressed }) => [styles.item, pressed && styles.pressed]} onPress={onPress}>
    <Text style={styles.hash}>#</Text>
    <Text numberOfLines={1} style={[styles.itemText, selected && { fontWeight: "700" }]}>{label}</Text>
    {selected ? <CheckMark size={16} /> : null}
  </Pressable>;
}

const styles = createStyles(() => ({
  backdrop: { flex: 1, backgroundColor: theme.colors.scrimLight },
  panel: { position: "absolute", left: 12, width: 240, maxHeight: "55%", borderRadius: 14, backgroundColor: theme.colors.surface, paddingVertical: 6, ...theme.shadow.menu },
  list: { maxHeight: 320 },
  item: { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  pressed: { backgroundColor: theme.colors.fill1 },
  hash: { color: theme.colors.link, fontSize: 15, fontWeight: "600" },
  itemText: { flex: 1, color: theme.colors.text, fontSize: 15 },
  divider: { height: theme.hairline, backgroundColor: theme.colors.border, marginHorizontal: 14, marginVertical: 2 },
  createRow: { minHeight: 48, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  createInput: { flex: 1, minHeight: 36, paddingHorizontal: 10, borderRadius: 8, backgroundColor: theme.colors.fill2, color: theme.colors.text, fontSize: 15 },
  createDone: { minHeight: 34, minWidth: 52, paddingHorizontal: 10, borderRadius: 17, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  createDoneText: { color: theme.colors.onAccent, fontSize: 13, fontWeight: "700" },
}));
