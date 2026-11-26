import type { ReactNode } from "react";
import { AgentRuntimeSetupGate } from "@codexly/ui/core/agent-runtime-setup-gate";
import { getCurrentLanguage } from "../../../i18n/i18n.js";
import { codexlyClient } from "../../projects/project-queries.js";

export function EngineSetupGate({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AgentRuntimeSetupGate client={codexlyClient} language={getCurrentLanguage()}>
      {children}
    </AgentRuntimeSetupGate>
  );
}
