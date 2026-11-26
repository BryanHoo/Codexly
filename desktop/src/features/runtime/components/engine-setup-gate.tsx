import type { ReactNode } from "react";
import { AgentRuntimeSetupGate } from "@codexly/ui/core/agent-runtime-setup-gate";
import { getCurrentLanguage } from "../../../i18n/i18n.js";
import { nativeClient } from "../../projects/project-queries.js";

export function EngineSetupGate({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AgentRuntimeSetupGate client={nativeClient} language={getCurrentLanguage()}>
      {children}
    </AgentRuntimeSetupGate>
  );
}
