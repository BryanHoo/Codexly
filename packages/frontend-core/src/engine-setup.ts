import { isAgentEngine } from "@codexly/protocol";
import type { AgentEngine } from "@codexly/protocol";

export const ENGINE_SETUP_KEY = "codeagent:engine-setup:v1";
export type EngineSetup = Readonly<{ engines: AgentEngine[]; complete: boolean }>;
export function readEngineSetup(raw: string | null): EngineSetup | undefined {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || !("engines" in value) || !("complete" in value))
      return undefined;
    if (
      !Array.isArray(value.engines) ||
      !value.engines.length ||
      value.engines.length > 256 ||
      typeof value.complete !== "boolean"
    )
      return undefined;
    if (!value.engines.every((engine) => isAgentEngine(engine))) return undefined;
    return { engines: [...new Set(value.engines)] as AgentEngine[], complete: value.complete };
  } catch {
    return undefined;
  }
}
