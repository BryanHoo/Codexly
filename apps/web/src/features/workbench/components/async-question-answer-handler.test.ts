import { expect, test, vi } from "vitest";
import { createElement } from "react";
import type { AnswerAsyncQuestionResponse } from "@codexly/protocol";
import { createAsyncQuestionAnswerHandler } from "./async-question-answer-handler.js";
import { questionTask } from "./async-question-test-fixtures.js";
import { useSubmissionStartedAt } from "./use-submission-started-at.js";
import { useWorkbenchComposerController } from "../hooks/use-workbench-composer-controller.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskTimeline } from "./task-timeline.js";
import {
  completedTurn,
  renderToStaticMarkup,
  snapshot,
  unpaginatedRuntime,
} from "./task-timeline.test-support.js";

const result: AnswerAsyncQuestionResponse = {
  questions: { data: [] },
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
    controller: {
      isCurrentScope: () => true,
      setIsSubmitting: vi.fn(),
      setSubmittedTurnState: vi.fn(),
    },
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
  const setIsSubmitting = vi.fn();
  createAsyncQuestionAnswerHandler({
    controller: { isCurrentScope: () => false, setIsSubmitting, setSubmittedTurnState: vi.fn() },
    requestScope: "old-task",
    store: undefined,
    onTurnStarted,
    onSteerAccepted,
    onDirectSubmission,
  })()(result);
  expect(onSteerAccepted).not.toHaveBeenCalled();
  expect(onTurnStarted).not.toHaveBeenCalled();
  expect(onDirectSubmission).not.toHaveBeenCalled();
  expect(setIsSubmitting).not.toHaveBeenCalled();
});

test.each(["start", "steer"] as const)(
  "ends local submission timing after an async answer is accepted through %s",
  (delivery) => {
    const capture =
      vi.fn<
        (value: {
          controller: ReturnType<typeof useWorkbenchComposerController>;
          timer: ReturnType<typeof useSubmissionStartedAt>;
        }) => void
      >();
    function Probe() {
      const timer = useSubmissionStartedAt();
      const controller = useWorkbenchComposerController(
        "task-a",
        timer.handleSubmissionStateChange,
      );
      capture({ controller, timer });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    const probe = capture.mock.calls[0]?.[0];
    if (probe === undefined) throw new Error("Controller was not rendered");
    const { controller, timer } = probe;
    const onTurnStarted = vi.fn(() => {
      // 新回合先接管提交起点，再释放本地计时，保证请求与流式事件逆序到达时也不丢失起点。
      expect(timer.getStartedAt()).toBeDefined();
    });
    const onSteerAccepted = vi.fn();
    createAsyncQuestionAnswerHandler({
      controller,
      requestScope: "task-a",
      store: undefined,
      onDirectSubmission: timer.beginSubmission,
      onTurnStarted,
      onSteerAccepted,
    })()({
      ...result,
      turn:
        delivery === "start"
          ? {
              id: "turn-a",
              status: "running",
              startedAt: "2026-09-12T00:00:01.000Z",
              completedAt: null,
              error: null,
              items: [],
            }
          : null,
    });

    // 模拟流式终态早于回答回执：按钮已空闲，时间线仍必须识别已完成回合。
    const store = createTaskStore(
      { projectId: snapshot.projectId, taskId: snapshot.id },
      {
        checkpoint: { sessionId: "session", sequence: 2 },
        snapshot: {
          ...snapshot,
          turns: [
            {
              ...completedTurn,
              id: "turn-a",
              items: [
                { id: "reply", type: "message", role: "assistant", text: "回答后的最终结果" },
              ],
            },
          ],
        },
      },
    );
    const markup = renderToStaticMarkup(
      createElement(TaskTimeline, {
        projectId: snapshot.projectId,
        taskId: snapshot.id,
        runtime: {
          ...unpaginatedRuntime,
          connectionState: "connected",
          error: null,
          isPending: false,
          store,
        },
        submissionStartedAt: timer.getStartedAt() ?? completedTurn.startedAt ?? snapshot.updatedAt,
        ...(timer.getStartedAt() === undefined ? { submissionTurnId: "turn-a" } : {}),
      }),
    );
    expect(markup).toContain("回答后的最终结果");
    expect(markup).not.toContain('aria-label="AI 回复正在运行"');
    // 回答回执本身已结束 HTTP 提交，不能等下一次 Composer 请求才撤销尾部占位。
    expect(timer.getStartedAt()).toBeUndefined();
    expect(onTurnStarted).toHaveBeenCalledTimes(delivery === "start" ? 1 : 0);
    expect(onSteerAccepted).toHaveBeenCalledTimes(delivery === "steer" ? 1 : 0);
  },
);
