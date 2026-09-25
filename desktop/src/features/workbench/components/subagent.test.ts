import type { AgentItem } from "@/protocol/index.js";
import { beforeAll, describe, expect, it } from "vitest";

import { i18n } from "../../../i18n/i18n.js";
import { getSubagentOperationTitle, parseSubagentOperation } from "./subagent.js";

function tool(name: string): Extract<AgentItem, { type: "tool" }> {
  return {
    id: `tool-${name}`,
    input: { prompt: "继续处理" },
    name,
    output: {
      agents: [{ nickname: "worker", status: "completed", taskId: "thread-child" }],
    },
    status: "completed",
    type: "tool",
  };
}

describe("Codex 0.152 多 Agent 工具", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it.each([
    ["agent/send_message", "向子代理发送消息"],
    ["agent/followup_task", "向子代理追加任务"],
    ["agent/interrupt", "中断子代理"],
    ["agent/list", "列出子代理"],
  ] as const)("识别 %s 并提供专用标题", (name, title) => {
    const operation = parseSubagentOperation(tool(name));
    expect(operation?.name).toBe(name);
    expect(operation?.agents[0]?.taskId).toBe("thread-child");
    expect(getSubagentOperationTitle(name)).toBe(title);
  });
});
