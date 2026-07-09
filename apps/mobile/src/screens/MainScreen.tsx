import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getChatContactDescription,
  getChatContactName,
  type ChatContact,
} from "../domain/chat/contacts";
import { t } from "../i18n";

type MainScreenProps = {
  contacts: ChatContact[];
  loadingContacts?: boolean;
  contactsError?: boolean;
  onReloadContacts?: () => void;
  onOpenChat: (contact: ChatContact) => void;
};

export function MainScreen({ contacts, loadingContacts = false, contactsError = false, onReloadContacts, onOpenChat }: MainScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <View>
            <Text style={styles.brand}>OIO</Text>
            <Text style={styles.brandSubtext}>{t("main.subtitle")}</Text>
          </View>
        </View>

        <View style={styles.conversationStack}>
          {loadingContacts && !contacts.length ? (
            <View style={styles.conversationRow}>
              <View style={styles.avatarCircle}>
                <Ionicons name="hourglass-outline" size={20} color="#7E8491" />
              </View>
              <View style={styles.conversationBody}>
                <Text style={styles.conversationTitle}>{t("main.contacts.loading")}</Text>
                <Text style={styles.conversationSubtitle}>{t("main.contacts.loading_hint")}</Text>
              </View>
            </View>
          ) : contactsError && !contacts.length ? (
            <Pressable style={styles.conversationRow} onPress={onReloadContacts}>
              <View style={styles.avatarCircle}>
                <Ionicons name="refresh-outline" size={20} color="#7E8491" />
              </View>
              <View style={styles.conversationBody}>
                <Text style={styles.conversationTitle}>{t("main.contacts.failed")}</Text>
                <Text style={styles.conversationSubtitle}>{t("common.retry")}</Text>
              </View>
            </Pressable>
          ) : contacts.map((contact, index) => (
            <Pressable
              key={contact.id}
              style={[
                styles.conversationRow,
                index === 0 && styles.conversationRowPrimary,
              ]}
              onPress={() => onOpenChat(contact)}
            >
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{contact.avatarLabel}</Text>
              </View>
              <View style={styles.conversationBody}>
                <Text style={styles.conversationTitle}>{getChatContactName(contact)}</Text>
                <Text style={styles.conversationSubtitle}>{getChatContactDescription(contact)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9AA0AB" />
            </Pressable>
          ))}
        </View>

        <View style={styles.emptyArea}>
          <View style={styles.promptCard}>
            <View style={styles.promptHeader}>
              <View style={styles.promptMark} />
              <Text style={styles.emptyTitle}>{t("main.prompt.title")}</Text>
            </View>
            <Text style={styles.emptyHint}>{t("main.prompt.hint")}</Text>
            <View style={styles.promptStack}>
              {(["main.prompt.1", "main.prompt.2", "main.prompt.3"] as const).map((key) => (
                <View key={key} style={styles.promptPill}>
                  <Text style={styles.promptText}>{t(key)}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F8FA",
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },

  brandRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  brand: {
    color: "#151515",
    fontSize: 23,
    fontWeight: "500",
  },
  brandSubtext: {
    marginTop: 6,
    color: "#737A86",
    fontSize: 14,
  },
  conversationStack: {
    marginTop: 28,
    gap: 12,
  },
  conversationRow: {
    minHeight: 82,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E4E5EA",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
  },
  conversationRowPrimary: {
    backgroundColor: "#F1F0FF",
    borderColor: "#E3DFFF",
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "#DADCE4",
    backgroundColor: "rgba(255,255,255,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#33333a",
    fontSize: 15,
    letterSpacing: 1,
  },
  conversationBody: {
    flex: 1,
    marginLeft: 13,
    paddingRight: 12,
  },
  conversationTitle: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "500",
  },
  conversationSubtitle: {
    marginTop: 4,
    color: "#7E8491",
    fontSize: 14,
    lineHeight: 20,
  },
  emptyArea: {
    flex: 1,
    paddingBottom: 104,
    alignItems: "center",
    justifyContent: "center",
  },
  promptCard: {
    width: "86%",
    maxWidth: 330,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E7E8ED",
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  promptHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  promptMark: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#746BFF",
  },
  emptyTitle: {
    marginLeft: 8,
    color: "#4F5663",
    fontSize: 13,
    fontWeight: "500",
  },
  emptyHint: {
    marginTop: 7,
    color: "#8B909B",
    fontSize: 12,
    lineHeight: 17,
  },
  promptStack: {
    marginTop: 12,
    gap: 8,
  },
  promptPill: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E8E9EE",
    backgroundColor: "#FFFFFF",
  },
  promptText: {
    color: "#626977",
    fontSize: 13,
  },

});
