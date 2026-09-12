import type { AnswerAsyncQuestionResponse } from "@codexly/protocol";
import type { TaskStore } from "../../conversation/runtime/task-store-core.js";
import { getTaskStoreUserMessageIds, type AcceptedSteerPrompt } from "../composer-queue-state.js";
import type { useWorkbenchComposerController } from "../hooks/use-workbench-composer-controller.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";

export function createAsyncQuestionAnswerHandler({
  controller,
  requestScope,
  store,
  onDirectSubmission,
  onTurnStarted,
  onSteerAccepted,
}: Readonly<{
  controller: Pick<
    ReturnType<typeof useWorkbenchComposerController>,
    "isCurrentScope" | "setSubmittedTurnState"
  >;
  requestScope: string;
  store: TaskStore | undefined;
  onDirectSubmission: WorkbenchComposerProps["onDirectSubmission"];
  onTurnStarted: WorkbenchComposerProps["onTurnStarted"];
  onSteerAccepted: (prompt: AcceptedSteerPrompt) => void;
}>) {
  return () => {
    // 发请求前记录已有用户消息，避免早于 HTTP 响应到达的事件被误算为旧消息。
    const state = store?.getState();
    const previousIds = new Map(
      state?.turnIds.map((id) => [id, getTaskStoreUserMessageIds(state, id)]),
    );
    return (result: AnswerAsyncQuestionResponse) => {
      // 路由切换后仅保留后端结果，不把旧任务的回答渲染到新任务。
      if (!controller.isCurrentScope(requestScope)) return;
      onDirectSubmission?.();
      if (result.turn !== null) {
        controller.setSubmittedTurnState({ scope: requestScope, turnId: result.turn.id });
        onTurnStarted?.(result.turn, result.input, []);
      } else {
        onSteerAccepted({
          id: result.messageId,
          files: [],
          skills: [],
          text: result.input.text,
          turnId: result.turnId,
          userMessageIds: previousIds.get(result.turnId) ?? [],
        });
      }
    };
  };
}
