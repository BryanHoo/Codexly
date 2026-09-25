import { expect, test, vi } from "vitest";
import { createComposerHandle } from "./workbench-composer-handle.js";

test.each([undefined, "turn-a"])("answers use ordinary submission without changing the draft (%s)", async (activeTurnId) => {
  const submitPrompt = vi.fn(async () => true);
  const clearMode = vi.fn();
  const handle = createComposerHandle({
    activeTurnId, buildPlanPrompt: "build plan", clearMode,
    referenceProjectPath: vi.fn(), submitCurrent: vi.fn(async () => true), submitPrompt,
  });
  await expect(handle.answerQuestions("范围\n当前文件")).resolves.toBe(true);
  expect(submitPrompt).toHaveBeenCalledExactlyOnceWith({ files: [], text: "范围\n当前文件" }, [], {
    clearInputOnSuccess: false, composerMode: null,
    forceAction: activeTurnId === undefined ? "start" : "steer",
  });
  expect(clearMode).not.toHaveBeenCalled();
});
