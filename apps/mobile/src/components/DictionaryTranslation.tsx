import React, { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Text } from "./Typography";
import { t } from "../i18n";
import { theme } from "../theme";

/** Mounted per lookup so translations start hidden, including cached results. */
export function DictionaryTranslation({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(expanded ? "dictionary.hide_translation" : "dictionary.show_translation")}
      accessibilityState={{ expanded }}
      onPress={() => setExpanded((value) => !value)}
      style={styles.toggle}
    >
      <Text style={styles.text}>{expanded ? text : t("dictionary.show_translation")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: { minHeight: 40, justifyContent: "center", paddingVertical: 6 },
  text: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 },
});
