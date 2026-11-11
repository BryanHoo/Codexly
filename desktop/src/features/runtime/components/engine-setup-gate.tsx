import { lazy, type ReactNode } from "react";
import { AgentRuntimeSetupGate } from "@codexly/ui/core/agent-runtime-setup-gate";
import { getCurrentLanguage } from "../../../i18n/i18n.js";
import { nativeClient } from "../../projects/project-queries.js";

const LegacyGate = lazy(() =>
  import("./legacy-engine-setup-gate.js").then((module) => ({ default: module.LegacyEngineSetupGate })),
);

export function EngineSetupGate({ children }: Readonly<{ children: ReactNode }>) {
  return <AgentRuntimeSetupGate client={nativeClient} language={getCurrentLanguage()}
    claudeSupported={import.meta.env.VITE_MACOS_LEGACY !== "true"}
    legacy={<LegacyGate>{children}</LegacyGate>}>
    {children}
  </AgentRuntimeSetupGate>;
}
