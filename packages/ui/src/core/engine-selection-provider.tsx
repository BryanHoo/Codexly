import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AgentEngine } from "@codexly/protocol";
import { createEngineActivation } from "@codexly/frontend-core/engine-activation";
import { ENGINE_SETUP_KEY } from "@codexly/frontend-core/engine-setup";
import {
  EngineActivationContext,
  SelectedEnginesContext,
  browserSetupStorage,
  type SetupStorage,
} from "./engine-selection.js";

/** 启用状态随设置更新即时广播，保持子树身份，避免重挂载正在运行的聊天。 */
export function EngineSelectionProvider({
  engines,
  storage = browserSetupStorage,
  children,
  synchronize = false,
}: Readonly<{
  engines: readonly AgentEngine[];
  storage?: SetupStorage;
  children: ReactNode;
  synchronize?: boolean;
}>) {
  const [activation] = useState(() =>
    createEngineActivation(engines, (next) => {
      storage.setItem(ENGINE_SETUP_KEY, JSON.stringify({ engines: next, complete: true }));
    }),
  );
  // 后台目录到达时更新同一个 store；不重建 Provider 或正在编辑的工作区。
  useEffect(() => {
    if (synchronize) activation.synchronize(engines);
  }, [activation, engines, synchronize]);
  const snapshot = useSyncExternalStore(
    activation.subscribe,
    activation.getSnapshot,
    activation.getSnapshot,
  );
  return (
    <EngineActivationContext value={activation}>
      <SelectedEnginesContext value={snapshot.engines}>{children}</SelectedEnginesContext>
    </EngineActivationContext>
  );
}
