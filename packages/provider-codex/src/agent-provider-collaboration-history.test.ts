import { describe, expect, it } from "vitest";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider collaboration history", () => {
  it("preserves structured subagent details from Codex collaboration items", async () => {
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_228_860,
              error: null,
              id: "turn-collaboration",
              items: [
                {
                  agentsStates: {
                    "child-frontend": { message: "前端分析完成", status: "completed" },
                  },
                  id: "collaboration-spawn",
                  model: "gpt-5.6-sol",
                  prompt: "理解前端项目",
                  reasoningEffort: "high",
                  receiverThreadIds: ["child-frontend"],
                  senderThreadId: "task-1",
                  status: "completed",
                  tool: "spawnAgent",
                  type: "collabAgentToolCall",
                },
                {
                  agentPath: "/root/frontend_analysis",
                  agentThreadId: "child-frontend",
                  id: "subagent-started",
                  kind: "started",
                  type: "subAgentActivity",
                },
                {
                  agentsStates: {
                    "child-frontend": { message: "继续检查测试", status: "completed" },
                  },
                  id: "collaboration-followup",
                  model: null,
                  prompt: "继续检查测试",
                  reasoningEffort: null,
                  receiverThreadIds: ["child-frontend"],
                  senderThreadId: "task-1",
                  status: "completed",
                  tool: "followupTask",
                  type: "collabAgentToolCall",
                },
                {
                  agentPath: "/root/frontend_analysis",
                  agentThreadId: "child-frontend",
                  id: "subagent-completed",
                  kind: "completed",
                  type: "subAgentActivity",
                },
              ],
              startedAt: 1_753_228_800,
              status: "completed",
            },
          ],
        }),
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const snapshot = await provider.readTask("task-1");

    expect(snapshot?.turns[0]?.items).toEqual([
      {
        id: "collaboration-spawn",
        input: {
          model: "gpt-5.6-sol",
          prompt: "理解前端项目",
          reasoningEffort: "high",
          receiverTaskIds: ["child-frontend"],
          senderTaskId: "task-1",
        },
        name: "agent/spawn",
        output: {
          agents: [
            {
              message: "前端分析完成",
              nickname: "frontend_analysis",
              status: "completed",
              taskId: "child-frontend",
            },
          ],
        },
        status: "completed",
        type: "tool",
      },
      {
        detail: "已启动",
        id: "subagent-started",
        label: "子代理 frontend_analysis",
        status: "completed",
        type: "activity",
      },
      {
        id: "collaboration-followup",
        input: {
          prompt: "继续检查测试",
          receiverTaskIds: ["child-frontend"],
          senderTaskId: "task-1",
        },
        name: "agent/followup_task",
        output: {
          agents: [
            {
              message: "继续检查测试",
              nickname: "frontend_analysis",
              status: "completed",
              taskId: "child-frontend",
            },
          ],
        },
        status: "completed",
        type: "tool",
      },
      {
        detail: "已完成",
        id: "subagent-completed",
        label: "子代理 frontend_analysis",
        status: "completed",
        type: "activity",
      },
    ]);
  });
});
