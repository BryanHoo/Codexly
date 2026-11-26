import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import { SubmitTaskRequestSchema } from "./task-submission.js";

it("ACP prompt 仅携带输入和应用任务身份，不接受旧 Turn 配置", () => {
  const input = {
    type: "acp-prompt",
    taskId: "app-task",
    input: { type: "prompt", attachments: [], skills: [], text: "继续" },
  };
  expect(Value.Check(SubmitTaskRequestSchema, input)).toBe(true);
  expect(Value.Check(SubmitTaskRequestSchema, { ...input, options: { model: "stale" } })).toBe(
    false,
  );
  expect(Value.Check(SubmitTaskRequestSchema, { ...input, sessionId: "native-session" })).toBe(
    false,
  );
});

it("新任务可携带 ACP 首发配置，已有任务不能覆盖权威会话", () => {
  const input = {
    type: "acp-prompt",
    engine: "claude",
    input: { type: "prompt", attachments: [], skills: [], text: "开始" },
    initialConfig: { enabled: false, model: "raw-model" },
  };
  expect(Value.Check(SubmitTaskRequestSchema, input)).toBe(true);
  expect(Value.Check(SubmitTaskRequestSchema, { ...input, taskId: "existing" })).toBe(false);
});
