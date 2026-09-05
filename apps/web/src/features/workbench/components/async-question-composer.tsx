import type { TaskStore } from "../../conversation/runtime/task-store-core.js";
import type { createComposerSubmission } from "./workbench-composer-submission.js";
import { AsyncQuestionDock } from "./async-question-dock.js";
import { AsyncQuestionProvider } from "./async-question-session.js";

export function AsyncQuestionComposer({
  enabled,
  activeTurnId,
  submit,
  taskStore,
}: Readonly<{
  enabled: boolean;
  activeTurnId: string | undefined;
  submit: ReturnType<typeof createComposerSubmission>;
  taskStore: TaskStore | undefined;
}>) {
  return (
    <AsyncQuestionProvider
      enabled={enabled}
      submit={(text) =>
        // 回答主动送入当前回合；不受跟进排队偏好影响，也不清空编辑中的正文。
        submit({ files: [], text }, [], {
          clearInputOnSuccess: false,
          composerMode: null,
          forceAction: activeTurnId === undefined ? "start" : "steer",
        })
      }
    >
      <AsyncQuestionDock taskStore={taskStore} />
    </AsyncQuestionProvider>
  );
}
