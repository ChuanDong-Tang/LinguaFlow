import { useCallback, useEffect, useRef, useState } from "react";

export type SyncPhase = "idle" | "checking" | "fetching" | "merging" | "settling";

export type ExclusiveSyncState<TKind extends string> = {
  kind: TKind | "idle";
  phase: SyncPhase;
  scopeKey: string | null;
  token: number;
};

type ActiveSync<TKind extends string> = {
  token: number;
  kind: TKind;
  scopeKey: string;
  controller: AbortController;
};

export function useExclusiveSyncMachine<TKind extends string>() {
  const nextTokenRef = useRef(1);
  const activeRef = useRef<ActiveSync<TKind> | null>(null);
  const [state, setState] = useState<ExclusiveSyncState<TKind>>({
    kind: "idle",
    phase: "idle",
    scopeKey: null,
    token: 0,
  });

  const setPhase = useCallback((token: number, phase: Exclude<SyncPhase, "idle">): void => {
    const active = activeRef.current;
    if (!active || active.token !== token) return;
    // 状态机只记录业务阶段，不直接管 UI；notice / loading 在外面根据 phase 做副作用。
    setState({
      kind: active.kind,
      phase,
      scopeKey: active.scopeKey,
      token: active.token,
    });
  }, []);

  const peek = useCallback((): ExclusiveSyncState<TKind> => state, [state]);

  const begin = useCallback((kind: TKind, scopeKey: string): { token: number; controller: AbortController } => {
    // 新任务进来时，直接让旧任务退场，避免旧同步和新同步同时抢 state / notice。
    activeRef.current?.controller.abort();
    const token = nextTokenRef.current++;
    const controller = new AbortController();
    activeRef.current = { token, kind, scopeKey, controller };
    setState({ kind, phase: "checking", scopeKey, token });
    return { token, controller };
  }, []);

  const settle = useCallback((token: number): void => {
    const active = activeRef.current;
    if (!active || active.token !== token) return;
    activeRef.current = null;
    // settle 只是把业务任务收尾，外层提示该 hide 还是 update 由页面自己决定。
    setState({ kind: "idle", phase: "idle", scopeKey: null, token });
  }, []);

  const cancel = useCallback((token?: number): void => {
    const active = activeRef.current;
    if (!active) return;
    if (token !== undefined && active.token !== token) return;
    active.controller.abort();
    activeRef.current = null;
    setState({ kind: "idle", phase: "idle", scopeKey: null, token: active.token });
  }, []);

  useEffect(() => {
    return () => {
      activeRef.current?.controller.abort();
      activeRef.current = null;
    };
  }, []);

  const isCurrent = useCallback((token: number): boolean => activeRef.current?.token === token, []);

  return {
    state,
    begin,
    setPhase,
    settle,
    cancel,
    isCurrent,
    peek,
  };
}
