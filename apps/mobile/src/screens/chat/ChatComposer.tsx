import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type ChatComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFocus: () => void;
  disabled: boolean;
  isSending: boolean;
};

export function ChatComposer({ value, onChangeText, onSend, onStop, onFocus, disabled, isSending }: ChatComposerProps) {
  return (
    <View style={styles.inputWrap}>
      <TextInput
        style={styles.input}
        placeholder="输入你想改写的内容..."
        placeholderTextColor="#9CA3AF"
        multiline
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
      />
      <Pressable
        style={[styles.sendButton, disabled && !isSending && styles.sendButtonDisabled]}
        onPress={isSending ? onStop : onSend}
        disabled={disabled && !isSending}
      >
        <Text style={styles.sendText}>{isSending ? "■" : "↑"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    borderTopWidth: 1,
    borderTopColor: "#F0F1F3",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FCFCFD",
  },
  input: {
    flex: 1,
    minHeight: 50,
    maxHeight: 110,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#EAEDF2",
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 18,
    color: "#111111",
    backgroundColor: "#FDFDFE",
  },
  sendButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#6F6BFF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 26,
    lineHeight: 28,
  },
});
