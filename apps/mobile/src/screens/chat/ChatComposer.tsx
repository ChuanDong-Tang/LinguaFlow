import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

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
      <View style={styles.inputShell}>
        <TextInput
          style={styles.input}
          placeholder="输入你想改写的内容..."
          placeholderTextColor="#A0A4AF"
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          returnKeyType="send"
          onSubmitEditing={isSending ? onStop : onSend}
        />
        <Pressable
          style={[styles.sendButton, disabled && !isSending && styles.sendButtonDisabled]}
          onPress={isSending ? onStop : onSend}
          disabled={disabled && !isSending}
          hitSlop={6}
        >
          <Ionicons name={isSending ? "square" : "arrow-up"} size={22} color="#8E84FF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 14,
    backgroundColor: "#FFFFFF",
  },
  inputShell: {
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: "#E7E7EE",
    backgroundColor: "#FFFFFF",
    position: "relative",
  },
  input: {
    flex: 1,
    height: 54,
    paddingLeft: 18,
    paddingRight: 64,
    fontSize: 16,
    color: "#111111",
  },
  sendButton: {
    position: "absolute",
    right: 8,
    top: 8,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
});
