import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

type ChatComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFocus: () => void;
  onBlur?: () => void;
  onDisabledPress?: () => void;
  disabled: boolean;
  isSending: boolean;
};

const COLLAPSED_MIN_HEIGHT = 50;
const COLLAPSED_MAX_HEIGHT = 160;
const INPUT_LINE_HEIGHT = 22;
const INPUT_PADDING_TOP = Platform.OS === "android" ? 13 : 12;
const INPUT_PADDING_BOTTOM = Platform.OS === "android" ? 13 : 12;
const INPUT_VERTICAL_PADDING = INPUT_PADDING_TOP + INPUT_PADDING_BOTTOM;
const INPUT_RIGHT_ACTION_SPACE = 64;
const TEXT_MEASURE_EPSILON = 1;
const IS_IOS = Platform.OS === "ios";

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onStop,
  onFocus,
  onBlur,
  onDisabledPress,
  disabled,
  isSending,
}: ChatComposerProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [contentTextHeight, setContentTextHeight] = useState(INPUT_LINE_HEIGHT);
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useMemo(() => Math.max(220, Math.min(420, Math.round(windowHeight * 0.5))), [windowHeight]);
  const measuredInputHeight = contentTextHeight + INPUT_VERTICAL_PADDING;
  const measuredLineCount = Math.max(1, Math.ceil(contentTextHeight / INPUT_LINE_HEIGHT));
  const collapsedHeight = Math.max(
    COLLAPSED_MIN_HEIGHT,
    Math.min(COLLAPSED_MAX_HEIGHT, measuredInputHeight)
  );
  const shellHeight = expanded ? expandedHeight : collapsedHeight;
  const canExpand = IS_IOS
    ? expanded || measuredLineCount >= 4
    : expanded || measuredInputHeight >= COLLAPSED_MAX_HEIGHT;
  const textInputHeight = shellHeight;
  const measureText = value.length > 0
    ? value.endsWith("\n") ? `${value} ` : value
    : " ";

  useEffect(() => {
    if (value.length > 0) return;
    setContentTextHeight(INPUT_LINE_HEIGHT);
    setExpanded(false);
  }, [value.length]);

  function handleToggleExpand(): void {
    setExpanded((current) => !current);
  }

  function handleMeasureTextHeight(nextHeight: number): void {
    const rounded = Math.max(INPUT_LINE_HEIGHT, Math.ceil(nextHeight));
    setContentTextHeight((current) =>
      Math.abs(current - rounded) <= TEXT_MEASURE_EPSILON ? current : rounded
    );
  }

  return (
    <View style={styles.inputWrap}>
      <View style={[styles.inputShell, { height: shellHeight }]}>
        <TextInput
          style={[
            styles.input,
            expanded ? styles.inputExpanded : styles.inputCollapsed,
            { height: textInputHeight },
          ]}
          placeholder=""
          placeholderTextColor="#A0A4AF"
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          onBlur={onBlur}
          returnKeyType="default"
          blurOnSubmit={false}
          cursorColor="#8E84FF"
          multiline
          scrollEnabled={expanded || collapsedHeight >= COLLAPSED_MAX_HEIGHT}
        />
        <Text
          style={styles.measureText}
          pointerEvents="none"
          onLayout={(event) => handleMeasureTextHeight(event.nativeEvent.layout.height)}
        >
          {measureText}
        </Text>
        {canExpand ? (
          <Pressable style={styles.expandButton} onPress={handleToggleExpand} hitSlop={6}>
            <Ionicons name={expanded ? "contract-outline" : "expand-outline"} size={14} color="#8E84FF" />
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.sendButton, (disabled || isSending) && styles.sendButtonDisabled]}
          onPress={isSending ? undefined : (disabled ? onDisabledPress : onSend)}
          disabled={isSending ? true : false}
          hitSlop={6}
        >
          <Ionicons name={"arrow-up"} size={18} color={disabled || isSending ? "#A0A4AF" : "#7F77F9"} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    backgroundColor: "#FCFCFD",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  inputShell: {
    minHeight: COLLAPSED_MIN_HEIGHT,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "#D9DDE6",
    backgroundColor: "#FFFFFF",
    position: "relative",
    justifyContent: "flex-start",
    alignItems: "stretch",
  },
  input: {
    alignSelf: "stretch",
    paddingLeft: 20,
    paddingRight: INPUT_RIGHT_ACTION_SPACE,
    lineHeight: INPUT_LINE_HEIGHT,
    fontSize: 15,
    color: "#111111",
    includeFontPadding: false,
    textAlignVertical: "top",
  },
  measureText: {
    position: "absolute",
    left: 20,
    right: INPUT_RIGHT_ACTION_SPACE,
    top: 0,
    opacity: 0,
    zIndex: -1,
    lineHeight: INPUT_LINE_HEIGHT,
    fontSize: 15,
    color: "#111111",
    includeFontPadding: false,
  },
  inputCollapsed: {
    paddingTop: INPUT_PADDING_TOP,
    paddingBottom: INPUT_PADDING_BOTTOM,
  },
  inputExpanded: {
    paddingTop: INPUT_PADDING_TOP,
    paddingBottom: INPUT_PADDING_BOTTOM,
  },
  expandButton: {
    position: "absolute",
    right: 15,
    top: 13,
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButton: {
    position: "absolute",
    right: 12,
    bottom: 5,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
});
