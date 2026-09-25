import type { AgentMessageAttachment, AgentTurn } from "@/protocol/index.js";
import { expect, it } from "vitest";

import { mergeSubmittedPromptIntoSnapshot, type RuntimeTaskSnapshot } from "./task-runtime.js";

const turn: AgentTurn = {
  id: "turn", status: "running", startedAt: null, completedAt: null, error: null,
  items: [{ id: "native-user", type: "message", role: "user", text: "修复代码", skills: [{ name: "rust" }] }],
};
const snapshot: RuntimeTaskSnapshot = {
  id: "task", projectId: "project", title: "Task", pinned: false, status: "running",
  updatedAt: "2026-09-12T00:00:00Z", pendingRequests: [], turns: [], turnsNextCursor: null,
  contextUsage: null, plan: null, goal: null,
  settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
    reasoningEffort: "high", sandboxMode: "workspace-write" },
};
const input = { text: "修复代码", skills: [{ id: "/skills/rust", name: "rust" }], attachments: [] };

it("直接使用原生规范化回合并在重复提交响应时保持快照引用", () => {
  const merged = mergeSubmittedPromptIntoSnapshot(snapshot, turn, input);
  expect(merged.turns[0]).toBe(turn);
  expect(mergeSubmittedPromptIntoSnapshot(merged, turn, input)).toBe(merged);
});

it("补齐乐观附件时保留原生 Skill、正文和消息身份", () => {
  const attachment: AgentMessageAttachment = {
    id: "attachment", kind: "file", name: "code.rs", mediaType: "text/plain", size: 12,
  };
  const current = { ...snapshot, turns: [turn] };
  const merged = mergeSubmittedPromptIntoSnapshot(current, turn, { ...input, messageAttachments: [attachment] });
  expect(merged.turns[0]?.items[0]).toEqual({ ...turn.items[0], attachments: [attachment] });
  expect(current.turns[0]?.items[0]).toBe(turn.items[0]);
});

it("原生启动响应暂缺消息时继续显示本次提交占位", () => {
  const merged = mergeSubmittedPromptIntoSnapshot(snapshot, { ...turn, items: [] }, input);
  expect(merged.turns[0]?.items[0]).toEqual({
    id: "submitted-user-turn", type: "message", role: "user", text: "修复代码", skills: [{ name: "rust" }],
  });
});
