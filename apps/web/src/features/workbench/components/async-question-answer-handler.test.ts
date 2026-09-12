import { expect, test, vi } from "vitest";
import type { AnswerAsyncQuestionResponse } from "@codexly/protocol";
import { createAsyncQuestionAnswerHandler } from "./async-question-answer-handler.js";
import { questionTask } from "./async-question-test-fixtures.js";

const result: AnswerAsyncQuestionResponse = {
  question: {
    id: "question",
    turnId: "turn-a",
    questions: [{ title: "范围", options: null }],
    status: "answered",
    createdAt: "2026-09-12T00:00:00.000Z",
  },
  input: { type: "prompt", text: "范围\n当前文件", attachments: [], skills: [] },
  messageId: "server-message",
  turnId: "turn-a",
  turn: null,
  checkpoint: { sessionId: "session", sequence: 1 },
};

test("captures existing messages before the answer request, including when events beat the HTTP response", () => {
  const oldMessage = { id: "old", type: "message" as const, role: "user" as const, text: "继续" };
  const store = questionTask([oldMessage]);
  const onSteerAccepted = vi.fn();
  const accept = createAsyncQuestionAnswerHandler({
    controller: { isCurrentScope: () => true, setSubmittedTurnState: vi.fn() },
    requestScope: "task-a",
    store,
    onSteerAccepted,
    onDirectSubmission: undefined,
    onTurnStarted: undefined,
  })();
  store.setState(questionTask([oldMessage, { ...oldMessage, id: "new" }]).getState());
  accept(result);
  expect(onSteerAccepted).toHaveBeenCalledWith(
    expect.objectContaining({ id: "server-message", userMessageIds: ["old"] }),
  );
});

test("ignores accepted results after navigating to a different task", () => {
  const onTurnStarted = vi.fn();
  const onSteerAccepted = vi.fn();
  const onDirectSubmission = vi.fn();
  createAsyncQuestionAnswerHandler({
    controller: { isCurrentScope: () => false, setSubmittedTurnState: vi.fn() },
    requestScope: "old-task",
    store: undefined,
    onTurnStarted,
    onSteerAccepted,
    onDirectSubmission,
  })()(result);
  expect(onSteerAccepted).not.toHaveBeenCalled();
  expect(onTurnStarted).not.toHaveBeenCalled();
  expect(onDirectSubmission).not.toHaveBeenCalled();
});
