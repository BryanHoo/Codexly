import { Value } from "@sinclair/typebox/value";
import { expect, test } from "vitest";
import { AgentTaskSnapshotSchema } from "./agent-runtime.js";

const common = {
  id: "history-task",
  projectId: "project",
  engine: "claude",
  title: "旧历史",
  pinned: false,
  updatedAt: "2026-11-10T00:00:00Z",
  status: "idle",
  contextUsage: null,
  goal: null,
  plan: null,
  pendingRequests: [],
  turns: [],
  turnsNextCursor: "older-page",
};
const settings = {
  model: "old-model",
  approvalPolicy: "never",
  approvalsReviewer: "user",
  reasoningEffort: "",
  sandboxMode: "read-only",
};

test("ACP 快照独立于旧设置，且没有标记不能省略旧契约", () => {
  expect(Value.Check(AgentTaskSnapshotSchema, { ...common, runtime: "acp" })).toBe(true);
  expect(Value.Check(AgentTaskSnapshotSchema, common)).toBe(false);
  expect(Value.Check(AgentTaskSnapshotSchema, { ...common, settings })).toBe(true);
  expect(Value.Check(AgentTaskSnapshotSchema, { ...common, settings, runtime: "acp" })).toBe(false);
});
