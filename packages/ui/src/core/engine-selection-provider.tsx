import { useState, useSyncExternalStore, type ReactNode } from "react";
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
}: Readonly<{
  engines: readonly AgentEngine[];
  storage?: SetupStorage;
  children: ReactNode;
}>) {
  const [activation] = useState(() =>
    createEngineActivation(engines, (next) => {
      storage.setItem(ENGINE_SETUP_KEY, JSON.stringify({ engines: next, complete: true }));
    }),
  );
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
