import { expect, test } from "vitest";
import { hasQueuedPromptFinishedInSnapshot, retainAcceptedSteerPrompt, type QueuedComposerPrompt } from "./composer-queue-state.js";

const prompt: QueuedComposerPrompt = {
  id: "answer", files: [], skills: [], status: "awaiting-response", text: "范围\n当前文件",
  turnId: "turn", userMessageIds: ["before"],
};

test("异步回答与引导均等待自己的用户消息，事件早于回执也只展示一次", () => {
  const other = { id: "other", type: "message" as const, role: "user" as const, text: "其他设备的消息" };
  expect(hasQueuedPromptFinishedInSnapshot(prompt, { turns: [{ id: "turn", status: "running", items: [other] }] })).toBe(false);
  const accepted = { ...other, id: "accepted", text: prompt.text };
  expect(retainAcceptedSteerPrompt([], prompt, () => "unused", {
    itemKeysByTurnId: { turn: ["accepted"] }, getItemByKey: () => accepted, turnsById: {},
  })).toEqual([]);
});

test("历史快照改名后的旧用户消息不能确认新发送", () => {
  expect(hasQueuedPromptFinishedInSnapshot(prompt, { turns: [{ id: "turn", status: "running", items: [
    { id: "history", identityAliases: ["before"], type: "message", role: "user", text: prompt.text },
  ] }] })).toBe(false);
});
