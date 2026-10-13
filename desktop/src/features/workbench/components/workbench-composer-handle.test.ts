import { expect, test, vi } from "vitest";
import { createComposerHandle } from "./workbench-composer-handle.js";

test("后续建议只填入草稿，不提交回合", () => {
  const insertFollowup = vi.fn();
  const submitPrompt = vi.fn(async () => true);
  const handle = createComposerHandle({
    activeTurnId: undefined, buildPlanPrompt: "build", clearMode: vi.fn(),
    referenceProjectPath: vi.fn(), submitCurrent: vi.fn(async () => true), submitPrompt, insertFollowup,
  });
  handle.insertFollowup("添加图表");
  expect(insertFollowup).toHaveBeenCalledExactlyOnceWith("添加图表");
  expect(submitPrompt).not.toHaveBeenCalled();
});

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
