import React, { createContext, forwardRef, useContext } from "react";
import { isDarkAppearance, theme } from "../theme";
import { Text as NativeText, TextInput as NativeTextInput, StyleSheet, type TextProps, type TextInputProps } from "react-native";
import { useFontSize } from "../services/preferences/fontSizePreference";
import { scaledFontMetrics } from "../services/preferences/fontSizeState";

const NestedText = createContext(false);
export type Text = NativeText;
export type TextInput = NativeTextInput;
export const Text = forwardRef<NativeText, TextProps>(function Text({ style, children, ...props }, ref) {
  const { scale } = useFontSize();
  const nested = useContext(NestedText);
  const metrics = scaledFontMetrics(StyleSheet.flatten(style) ?? {}, scale, nested);
  return <NestedText.Provider value={true}><NativeText {...props} ref={ref} style={[nested ? null : { color: theme.colors.text }, style, metrics]}>{children}</NativeText></NestedText.Provider>;
});
export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  const { scale } = useFontSize();
  const flat = StyleSheet.flatten(style) ?? {};
  // Explicit input heights must grow with their text, including single-line
  // cloze inputs. Do not shrink touch targets for the small option.
  const bounds = Object.fromEntries(["height", "minHeight", "maxHeight"].flatMap(key => {
    const value = flat[key as keyof typeof flat];
    return typeof value === "number" ? [[key, value * Math.max(1, scale)]] : [];
  }));
  return <NativeTextInput keyboardAppearance={isDarkAppearance() ? "dark" : "light"} placeholderTextColor={theme.colors.textFaint} {...props} ref={ref} style={[{ color: theme.colors.text }, style, scaledFontMetrics(flat, scale), bounds]} />;
});
