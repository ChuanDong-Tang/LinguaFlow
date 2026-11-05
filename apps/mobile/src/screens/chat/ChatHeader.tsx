import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { getChatContactDescription, getChatContactName, type ChatContact } from "../../domain/chat/contacts";
import { t } from "../../i18n";
import OioCharacter from "../../../assets/app/oio-character.svg";
import { theme } from "../../theme";

type ChatHeaderProps = {
  contact: ChatContact;
  onBack: () => void;
  onOpenCalendar: () => void;
  onOpenMenu?: () => void;
};

export function ChatHeader({ contact, onBack, onOpenCalendar, onOpenMenu }: ChatHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.backButton} hitSlop={8}>
        <Icon name="chevron-back" size={24} color={theme.colors.text} />
      </Pressable>

      <View style={[styles.headerAvatarWrap, contact.id === "curious_companion" && styles.characterAvatarWrap]}>
        {contact.id === "curious_companion"
          ? <OioCharacter width={38} height={36} />
          : <Text style={styles.logoText}>{contact.avatarLabel}</Text>}
      </View>

      <View style={styles.headerBody}>
        <Text style={styles.headerTitle}>{getChatContactName(contact)}</Text>
        <Text style={styles.headerSubTitle}>{getChatContactDescription(contact)}</Text>
      </View>

      <Pressable accessibilityLabel={t("chat.date.select")} style={styles.calendarButton} hitSlop={8} onPress={onOpenCalendar}>
        <Icon name="calendar-outline" size={22} color={theme.colors.text} />
      </Pressable>

      {onOpenMenu ? (
        <Pressable style={styles.menuButton} hitSlop={8} onPress={onOpenMenu}>
          <Icon name="ellipsis-horizontal" size={22} color={theme.colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 68,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarWrap: {
    marginLeft: 6,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  characterAvatarWrap: { borderWidth: 0, borderRadius: 0 },
  logoText: {
    fontSize: 12,
    color: theme.colors.accent,
    letterSpacing: 0,
  },
  headerBody: {
    marginLeft: 9,
    flex: 1,
    paddingRight: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: theme.colors.text,
  },
  headerSubTitle: {
    marginTop: 2,
    color: theme.colors.accent,
    fontSize: 11.5,
    lineHeight: 16,
  },
  calendarButton: {
    width: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  menuButton: {
    marginLeft: 6,
    width: 34,
    alignItems: "center",
    justifyContent: "center",
  },
});
