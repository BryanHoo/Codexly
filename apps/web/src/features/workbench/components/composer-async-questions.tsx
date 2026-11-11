import { AsyncQuestionComposer } from "./async-question-composer.js";
import { createAsyncQuestionAnswerHandler } from "./async-question-answer-handler.js";
import type { useComposerSession } from "./workbench-composer-session.js";

/** 问答展示与回答绑定复用原控制器，避免输入框主组件重复编排事件参数。 */
export function createComposerQuestions(
  session: ReturnType<typeof useComposerSession>,
  input: Omit<
    Parameters<typeof createAsyncQuestionAnswerHandler>[0],
    "controller" | "requestScope"
  > & { projectId: string; taskId: string | undefined },
) {
  const { projectId, taskId, ...answer } = input;
  return (
    <AsyncQuestionComposer
      key={session.composerScope}
      projectId={projectId}
      taskId={taskId}
      enabled={!session.turnControlsDisabled}
      isTaskRunning={session.state === "running" || session.state === "reconnecting"}
      onAnswered={createAsyncQuestionAnswerHandler({
        ...answer,
        controller: session.composerController,
        requestScope: session.routeScope,
      })}
    />
  );
}
