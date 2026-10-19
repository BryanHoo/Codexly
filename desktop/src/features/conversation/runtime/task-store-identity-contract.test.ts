import { taskIdentityContract } from "@codexly/frontend-core/testing/task-identity-contract";
import { Value } from "@sinclair/typebox/value";
import { expect, test } from "vitest";
import { AgentMessageItemSchema } from "@/protocol/index.js";
import { createTaskStore } from "./task-store.js";

taskIdentityContract((initial) => createTaskStore({ projectId: "project", taskId: "task" }, initial));

test("原生消息协议接受明确别名且拒绝重复别名", () => {
  const item = { id: "canonical", type: "message", role: "assistant", text: "权威正文", identityAliases: ["old"] };
  expect(Value.Check(AgentMessageItemSchema, item)).toBe(true);
  expect(Value.Check(AgentMessageItemSchema, { ...item, identityAliases: ["old", "old"] })).toBe(false);
});
