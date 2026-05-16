type SessionInvalidListener = () => void;

const invalidListeners = new Set<SessionInvalidListener>();

export function onSessionInvalid(listener: SessionInvalidListener): () => void {
  invalidListeners.add(listener);
  return () => {
    invalidListeners.delete(listener);
  };
}

export function emitSessionInvalid(): void {
  for (const listener of invalidListeners) {
    try {
      listener();
    } catch {
      // Keep notifying remaining listeners even if one handler throws.
    }
  }
}
