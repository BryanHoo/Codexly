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
import { savedPromptsStore } from "@codexly/ui/core/saved-prompts-store";

vi.mock("../hooks/use-workbench-branch-switch.js", () => ({
  useWorkbenchBranchSwitch: () => ({
    worktrees: [], createBranch: vi.fn(), switchBranch: vi.fn(),
    createWorktree: vi.fn(), switchWorktree: vi.fn(),
  }),
}));

function createComposerProps(
  composerRef: NonNullable<WorkbenchComposerProps["composerRef"]>,
  onCaptureSubmission: NonNullable<WorkbenchComposerProps["onCaptureSubmission"]>,
): WorkbenchComposerProps {
  return {
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
}

test.each([1280, 1920])("locks the whole composer while preserving the draft and rejecting imperative actions (%s)", async (width) => {
  await page.viewport(width, 720);
  await i18n.changeLanguage("zh-CN");
  const composerRef = createRef<WorkbenchComposerHandle>();
  const onCaptureSubmission = vi.fn(async () => undefined);
  const queryClient = new QueryClient();
  const props = createComposerProps(composerRef, onCaptureSubmission);
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

test("preserves immediate text selection after choosing a skill", async () => {
  await i18n.changeLanguage("zh-CN");
  const props = createComposerProps(createRef<WorkbenchComposerHandle>(), vi.fn(async () => undefined));
  const screen = await render(<QueryClientProvider client={new QueryClient()}><TooltipProvider>
    <ProjectDraftProvider><ComposerDraftProvider><WorkbenchComposer {...props}
      capabilities={{ provider: "codex", feedback: { upload: false },
        goals: { clear: false, read: false, update: false }, skills: { list: true, use: true },
        tasks: { fork: false, list: true, read: true, start: true },
        turns: { compact: false, interrupt: true, review: false, start: true, steer: true } }}
      skills={[{ id: "security", name: "review-security", displayName: "Security review", description: "Review security", scope: "system" }]}
    /></ComposerDraftProvider></ProjectDraftProvider>
  </TooltipProvider></QueryClientProvider>);
  await screen.getByRole("textbox").fill("/security");
  await expect.element(screen.getByRole("option", { name: /Security review/u })).toBeVisible();
  const input = screen.getByRole("textbox").element() as HTMLTextAreaElement;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  input.setSelectionRange(0, input.value.length);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(input.value).toBe("$review-security");
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(input.value.length);
});

test.each(["keyboard", "pointer"])("inserts a saved prompt at the cursor and keeps surrounding text (%s)", async (method) => {
  await i18n.changeLanguage("zh-CN");
  const saved = savedPromptsStore.save({ name: "测试插入", shortcut: "cursor-test", content: "检查实现。\n补充测试。" });
  const submitted = vi.fn(async () => undefined);
  const props = createComposerProps(createRef<WorkbenchComposerHandle>(), submitted);
  const screen = await render(<QueryClientProvider client={new QueryClient()}><TooltipProvider>
    <div style={{ paddingTop: 300 }}><ProjectDraftProvider><ComposerDraftProvider><WorkbenchComposer {...props} /></ComposerDraftProvider></ProjectDraftProvider></div>
  </TooltipProvider></QueryClientProvider>);
  try {
    const input = screen.getByRole("textbox").element() as HTMLTextAreaElement;
    await screen.getByRole("textbox").fill("前文 /cursor-test 后文");
    input.setSelectionRange(15, 15);
    // 光标移动后继续输入，触发当前光标处的匹配，保留光标后的已有文本。
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "前文 /cursor-tes 后文");
    input.setSelectionRange(14, 14);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const option = screen.getByRole("option", { name: /测试插入/u });
    await expect.element(option).toBeVisible();
    if (method === "pointer") await option.click();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    expect(input.value).toBe("前文 检查实现。\n补充测试。 后文");
    expect(input.selectionStart).toBe(14);
    expect(input.selectionEnd).toBe(14);
    expect(document.activeElement).toBe(input);
    expect(submitted).not.toHaveBeenCalled();
    input.setSelectionRange(0, input.value.length);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(input.selectionStart).toBe(0);
  } finally { savedPromptsStore.remove(saved.id); }
});

test("bounds the default slash menu and matches entries outside its initial subset", async () => {
  await i18n.changeLanguage("zh-CN");
  const prompts = Array.from({ length: 30 }, (_, index) => savedPromptsStore.save({ name: `有界测试 ${index}`, shortcut: `bounded-${index}`, content: "测试内容" }));
  const props = createComposerProps(createRef<WorkbenchComposerHandle>(), vi.fn(async () => undefined));
  const screen = await render(<QueryClientProvider client={new QueryClient()}><TooltipProvider>
    <div style={{ paddingTop: 420 }}><ProjectDraftProvider><ComposerDraftProvider><WorkbenchComposer {...props} /></ComposerDraftProvider></ProjectDraftProvider></div>
  </TooltipProvider></QueryClientProvider>);
  try {
    await screen.getByRole("textbox").fill("/");
    await expect.poll(() => screen.getByRole("option").all().length).toBe(12);
    const options = screen.getByRole("option").all();
    options.forEach((option, index) => expect(option.element().id.endsWith(`-item-${index}`)).toBe(true));
    const input = screen.getByRole("textbox").element() as HTMLTextAreaElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }));
    await expect.element(options[1]!).toHaveAttribute("data-active", "true");
    await screen.getByRole("textbox").fill("/bounded-29");
    await expect.element(screen.getByRole("option", { name: /有界测试 29/u })).toBeVisible();
    expect(screen.getByRole("option").all()).toHaveLength(1);
  } finally { for (const prompt of prompts) savedPromptsStore.remove(prompt.id); }
});


test("切换项目后使用各自提示词，临时会话恢复全局版本", async () => {
  await i18n.changeLanguage("zh-CN");
  const prompts = [
    savedPromptsStore.save({ name: "范围全局", shortcut: "scope-check", content: "全局内容" }),
    savedPromptsStore.save({ name: "范围 A", shortcut: "scope-check", content: "A 内容", projectId: "scope-a" }),
    savedPromptsStore.save({ name: "范围 B", shortcut: "scope-check", content: "B 内容", projectId: "scope-b" }),
  ];
  const props = createComposerProps(createRef<WorkbenchComposerHandle>(), vi.fn(async () => undefined));
  const client = new QueryClient();
  const view = (projectId: string) => <QueryClientProvider client={client}><TooltipProvider>
    <div style={{ paddingTop: 420 }}><ProjectDraftProvider><ComposerDraftProvider><WorkbenchComposer {...props} projectId={projectId} /></ComposerDraftProvider></ProjectDraftProvider></div>
  </TooltipProvider></QueryClientProvider>;
  const screen = await render(view("scope-a"));
  try {
    for (const [projectId, name, content] of [["scope-a", "范围 A", "A 内容"], ["scope-b", "范围 B", "B 内容"], ["temporary", "范围全局", "全局内容"]]) {
      await screen.rerender(view(projectId!));
      await screen.getByRole("textbox").fill("前文 /scope-check");
      await expect.element(screen.getByRole("option", { name: new RegExp(name!, "u") })).toBeVisible();
      expect(screen.getByRole("option").all()).toHaveLength(1);
      await screen.getByRole("option", { name: new RegExp(name!, "u") }).click();
      await expect.element(screen.getByRole("textbox")).toHaveValue(`前文 ${content}`);
    }
  } finally { for (const prompt of prompts) savedPromptsStore.remove(prompt.id); }
});
