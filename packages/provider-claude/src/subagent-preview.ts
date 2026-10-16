import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { record, text } from "./sdk-values.js";

/** 完成摘要与真实终态留在有界工具快照中，不依赖子代理可变投影继续驻留。 */
export function createClaudeAgentPreview(
  item: Extract<AgentItem, { type: "tool" }>,
  turn: AgentTurn,
  parentTaskId: string,
  nativeTaskId: string | null,
  status?: AgentTurn["status"],
  summary?: string,
): AgentItem {
  const input = record(item.input),
    output = record(item.output);
  const agents = Array.isArray(output["agents"]) ? output["agents"] : [];
  const previous = record(agents[0]);
  return {
    ...item,
    status: status ?? item.status,
    output: {
      ...output,
      parentTaskId,
      agents: [
        {
          ...previous,
          taskId: item.id,
          nativeTaskId,
          nickname: text(input["description"]) || text(input["subagent_type"]) || "Agent",
          status: status ?? previous["status"] ?? "running",
          ...(summary ? { message: summary.slice(0, 8192) } : {}),
        },
      ],
      turn,
    },
  };
}
