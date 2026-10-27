import { expect, test } from "vitest";
import { hasPromptDeliveryFinished } from "./prompt-delivery.js";

const prompt = { text: "继续检查", attachmentIds: ["file-a"], skillNames: ["review"] };
const item = {
  type: "message",
  role: "user",
  id: "new",
  text: prompt.text,
  attachments: [{ id: "file-a" }],
  skills: [{ name: "review" }],
};

test("附件和技能均对应本次输入时才确认发送", () => {
  expect(hasPromptDeliveryFinished([], [item], "running", prompt)).toBe(true);
  expect(
    hasPromptDeliveryFinished(
      [],
      [{ ...item, attachments: [{ id: "file-b" }] }],
      "running",
      prompt,
    ),
  ).toBe(false);
  expect(
    hasPromptDeliveryFinished([], [{ ...item, skills: [{ name: "other" }] }], "running", prompt),
  ).toBe(false);
});

test("旧消息别名不确认新发送，权威回合终态始终结束等待", () => {
  expect(
    hasPromptDeliveryFinished(
      ["live"],
      [{ ...item, identityAliases: ["live"] }],
      "running",
      prompt,
    ),
  ).toBe(false);
  expect(hasPromptDeliveryFinished([], [], undefined, prompt)).toBe(false);
  expect(hasPromptDeliveryFinished([], [], "completed", prompt)).toBe(true);
});
