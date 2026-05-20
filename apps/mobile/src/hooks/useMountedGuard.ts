import { useCallback, useEffect, useRef } from "react";
import { Alert } from "react-native";

export function useMountedGuard() {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isMounted = useCallback(() => mountedRef.current, []);

  const safeAlert = useCallback((title: string, message: string) => {
    if (!mountedRef.current) return;
    Alert.alert(title, message);
  }, []);

  return { isMounted, safeAlert };
}
