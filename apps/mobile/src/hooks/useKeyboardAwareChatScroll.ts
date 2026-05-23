import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

export function useKeyboardAwareChatScroll(
  scrollToBottom: (animated?: boolean) => void,
  messageCount: number
): number {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const onKeyboardShow = (event: any) => {
      const height = Math.max(0, event.endCoordinates?.height ?? 0);
      setKeyboardInset(height);
      scrollToBottom(false);
      setTimeout(() => scrollToBottom(false), 32);
    };
    const onKeyboardHide = () => {
      setKeyboardInset(0);
      scrollToBottom(false);
      setTimeout(() => scrollToBottom(false), 32);
    };
    const showSub = Keyboard.addListener("keyboardDidShow", onKeyboardShow);
    const hideSub = Keyboard.addListener("keyboardDidHide", onKeyboardHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToBottom]);

  useEffect(() => {
    if (keyboardInset <= 0) return;
    const timer = setTimeout(() => {
      scrollToBottom(false);
    }, 48);
    return () => clearTimeout(timer);
  }, [keyboardInset, messageCount, scrollToBottom]);

  return keyboardInset;
}
