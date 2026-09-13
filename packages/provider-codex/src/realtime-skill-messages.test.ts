import { expect, test } from "vitest";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { RealtimeSkillMessages } from "./realtime-skill-messages.js";

const user = { id: "user", type: "message" as const, role: "user" as const, text: "$check\n继续" };
const skill = { ...user, id: "expanded", text: "", skills: [{ name: "check" }] };
const event = (item: AgentItem, taskId = "task") => ({
  type: "item.completed" as const,
  taskId,
  turnId: "turn",
  itemId: item.id,
  payload: { item },
});
const turn = (items: AgentItem[]): AgentTurn => ({
  id: "turn",
  items,
  status: "running",
  error: null,
  startedAt: null,
  completedAt: null,
});

test("combines expanded skill notifications into a complete user item", () => {
  const messages = new RealtimeSkillMessages();
  messages.event(event(user));
  const expected = {
    itemId: "user",
    payload: { item: { ...user, text: "继续", skills: [{ name: "check" }] } },
  };
  expect(messages.event(event(skill))).toMatchObject(expected);
  expect(messages.event(event(skill))).toMatchObject(expected);
});

test("seeds a running snapshot and preserves its attachments", () => {
  const messages = new RealtimeSkillMessages();
  const attachments = [
    { id: "image", name: "image.png", kind: "image" as const, mediaType: "image/png", size: 68 },
  ];
  messages.seed("task", [turn([{ ...user, attachments }])]);
  expect(messages.event(event(skill))).toMatchObject({
    itemId: "user",
    payload: { item: { text: "继续", attachments } },
  });
});

test("does not merge across tasks, assistant output or cleared lifecycle", () => {
  const messages = new RealtimeSkillMessages();
  messages.event(event(user));
  expect(messages.event(event(skill, "other"))).toMatchObject({ itemId: "expanded" });
  messages.event({
    type: "message.delta",
    taskId: "task",
    turnId: "turn",
    itemId: "assistant",
    payload: { delta: "输出" },
  });
  expect(messages.event(event(skill))).toMatchObject({ itemId: "expanded" });
  messages.event(event(user));
  messages.clearTask("task");
  expect(messages.event(event(skill))).toMatchObject({ itemId: "expanded" });
  messages.event(event(user));
  messages.clear();
  expect(messages.event(event(skill))).toMatchObject({ itemId: "expanded" });
});

test("does not discard an attachment carried by a skill-only input", () => {
  const messages = new RealtimeSkillMessages();
  messages.event(event(user));
  const withImage = {
    ...skill,
    attachments: [
      { id: "image", name: "image.png", kind: "image" as const, mediaType: "image/png", size: 68 },
    ],
  };
  expect(messages.event(event(withImage))).toEqual(event(withImage));
});

test("limits retained user content instead of truncating it", () => {
  const messages = new RealtimeSkillMessages();
  messages.event(event({ ...user, text: "a".repeat(70000) }));
  expect(messages.event(event(skill))).toEqual(event(skill));
});

test("does not let an older snapshot reopen adjacency after assistant output", () => {
  const messages = new RealtimeSkillMessages();
  messages.event(event(user));
  messages.event({
    type: "message.delta",
    taskId: "task",
    turnId: "turn",
    itemId: "assistant",
    payload: { delta: "输出" },
  });
  messages.seed("task", [turn([user])]);
  expect(messages.event(event(skill))).toEqual(event(skill));
});

test("retains known skills when the same user item is completed again", () => {
  const messages = new RealtimeSkillMessages();
  messages.event(event(user));
  messages.event(event(skill));
  expect(messages.event(event(user))).toMatchObject({
    payload: { item: { text: "继续", skills: [{ name: "check" }] } },
  });
});

test("preserves the full body when a skill-only update reuses the user identity", () => {
  const messages = new RealtimeSkillMessages();
  messages.event(event(user));
  messages.event(event(skill));
  expect(messages.event(event({ ...skill, id: user.id }))).toMatchObject({
    payload: { item: { text: "继续" } },
  });
});
