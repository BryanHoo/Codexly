import type { WorkbenchComposerHandle } from "./workbench-composer-contracts.js";
import type { createComposerSubmission } from "./workbench-composer-submission.js";

export function createComposerHandle({
  activeTurnId, buildPlanPrompt, clearMode, disabled = false, referenceProjectPath, submitCurrent, submitPrompt, insertFollowup = () => undefined,
}: Readonly<{
  activeTurnId: string | undefined;
  disabled?: boolean;
  buildPlanPrompt: string;
  clearMode: () => void;
  referenceProjectPath: WorkbenchComposerHandle["referenceProjectPath"];
  submitCurrent: WorkbenchComposerHandle["submitCurrent"];
  insertFollowup?: WorkbenchComposerHandle["insertFollowup"];
  submitPrompt: ReturnType<typeof createComposerSubmission>;
}>): WorkbenchComposerHandle {
  if (disabled) return {
    insertFollowup,
    answerQuestions: async () => false, buildPlan: async () => false,
    referenceProjectPath: () => undefined, submitCurrent: async () => false,
  };
  return {
    insertFollowup,
    answerQuestions: (text) => submitPrompt({ files: [], text }, [], {
      // 问题回答复用提交锁，但不清空草稿、不继承计划或 Goal 模式，也不排队。
      clearInputOnSuccess: false,
      composerMode: null,
      forceAction: activeTurnId === undefined ? "start" : "steer",
    }),
    buildPlan: () => {
      clearMode();
      return submitPrompt({ files: [], text: buildPlanPrompt }, [], {
        composerMode: null, forceAction: "start",
      });
    },
    referenceProjectPath,
    submitCurrent,
  };
}
