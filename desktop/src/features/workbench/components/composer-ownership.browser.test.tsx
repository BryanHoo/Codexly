import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ComposerDraftProvider } from "../composer-draft-context.js";
import { ProjectDraftProvider } from "../project-draft-context.js";
import { WorkbenchComposer, type WorkbenchComposerHandle, type WorkbenchComposerProps } from "./workbench-composer.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import { i18n } from "../../../i18n/i18n.js";
import { page } from "vitest/browser";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

vi.mock("../hooks/use-workbench-branch-switch.js", () => ({
  useWorkbenchBranchSwitch: () => ({
    worktrees: [], createBranch: vi.fn(), switchBranch: vi.fn(),
    createWorktree: vi.fn(), switchWorktree: vi.fn(),
  }),
}));

test.each([1280, 1920])("locks the whole composer while preserving the draft and rejecting imperative actions (%s)", async (width) => {
  await page.viewport(width, 720);
  await i18n.changeLanguage("zh-CN");
  const composerRef = createRef<WorkbenchComposerHandle>();
  const onCaptureSubmission = vi.fn(async () => undefined);
  const queryClient = new QueryClient();
  const props: WorkbenchComposerProps = {
    capabilities: undefined, client: {} as WorkbenchComposerProps["client"], composerRef,
    fastModeAvailable: true, fastModeDefault: false, followUpBehavior: "queue",
    initialDraft: { content: [{ type: "text", text: "保留未发送草稿" }], attachments: [] },
    models: [{ id: "model", displayName: "Model", description: "", isDefault: true,
      defaultReasoningEffort: "high", supportedReasoningEfforts: [{ id: "high", description: "" }], inputModalities: ["text"] }],
    modelsError: null, modelsPending: false, onCaptureSubmission,
    onSettingsChange: vi.fn(), onFastModeChange: vi.fn(), onOpenProjectPath: vi.fn(),
    onProjectRootChange: vi.fn(), onTaskStarted: vi.fn(), projectId: "temporary",
    projectName: "项目", projectPath: "/work", projectPathOpenDisabled: false,
    projectToolsEnabled: false, projectRoots: [], selectedProjectRootId: "",
    settings: { model: "model", reasoningEffort: "high", approvalPolicy: "on-request", approvalsReviewer: "user", sandboxMode: "workspace-write" },
    skills: [], taskId: "task-a",
  };
  const view = (writeAccess: string, taskId = "task-a") => <QueryClientProvider client={queryClient}>
    <TooltipProvider><ProjectDraftProvider><ComposerDraftProvider><WorkbenchComposer {...props} taskId={taskId}
      runtime={{ connectionState: "connected", error: null, writeAccess } as TaskRuntimeView} />
    </ComposerDraftProvider></ProjectDraftProvider></TooltipProvider>
  </QueryClientProvider>;
  const screen = await render(view("checking"));
  const coldEditor = screen.getByRole("textbox").element() as HTMLTextAreaElement;
  expect(coldEditor.disabled).toBe(true);
  expect(coldEditor.closest("[inert]")).not.toBeNull();
  await screen.rerender(view("writable"));
  await screen.getByRole("textbox").click();
  expect(document.activeElement).toBe(coldEditor);
  expect(coldEditor.disabled).toBe(false);
  await screen.getByRole("textbox").fill("保留未发送草稿");
  const editor = coldEditor;
  expect(editor.value).toContain("保留未发送草稿");
  await screen.rerender(view("external"));
  await expect.element(screen.getByText("当前任务正在其他客户端进行")).toBeVisible();
  expect(editor.disabled).toBe(true);
  expect(editor.closest("[inert]")).not.toBeNull();
  const overlay = screen.getByText("当前任务正在其他客户端进行").element().parentElement!;
  const form = editor.closest("form")!;
  const overlayRect = overlay.getBoundingClientRect();
  const formRect = form.getBoundingClientRect();
  expect(overlayRect.top).toBeLessThanOrEqual(formRect.top);
  expect(overlayRect.bottom).toBeGreaterThanOrEqual(formRect.bottom);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  for (const button of form.querySelectorAll("button")) expect(button.matches(":disabled")).toBe(true);
  // Chromium 在下一次渲染更新时才把焦点移出刚变为 inert 的编辑器。
  await expect.poll(() => document.activeElement).not.toBe(editor);
  editor.focus();
  expect(document.activeElement).not.toBe(editor);
  await expect(composerRef.current!.submitCurrent()).resolves.toBe(false);
  await expect(composerRef.current!.answerQuestions("回答")).resolves.toBe(false);
  await expect(composerRef.current!.buildPlan()).resolves.toBe(false);
  expect(onCaptureSubmission).not.toHaveBeenCalled();
  expect(editor.value).toContain("保留未发送草稿");
  await screen.rerender(view("writable", "task-b"));
  expect(screen.getByRole("textbox").element().hasAttribute("disabled")).toBe(false);
  await expect.element(screen.getByText("当前任务正在其他客户端进行")).not.toBeInTheDocument();
});
