import { agentEngineName, type AgentEngine } from "@codexly/protocol";
import { useSelectedEngines } from "./engine-selection.js";

const fallbackEngines: readonly AgentEngine[] = ["codex", "claude"];

/** 新计划和旧计划配置共用启用目录，已保存的 Agent 即使停用也仍可辨认。 */
export function AcpScheduledAgentOptions({
  engine,
  placeholder,
}: Readonly<{ engine: AgentEngine | ""; placeholder: string }>) {
  const engines = useSelectedEngines() ?? fallbackEngines;
  return (
    <>
      <option value="" disabled>
        {placeholder}
      </option>
      {engine && !engines.includes(engine) ? (
        <option value={engine}>{agentEngineName(engine)}</option>
      ) : null}
      {engines.map((available) => (
        <option key={available} value={available}>
          {agentEngineName(available)}
        </option>
      ))}
    </>
  );
}
