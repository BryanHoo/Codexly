import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import { WorkbenchComposer as WebComposer } from "../../../apps/web/src/features/workbench/components/workbench-composer.js";
import { WorkbenchComposer as NativeComposer } from "../../src/features/workbench/components/workbench-composer.js";
import { ComposerDraftProvider as WebDraft } from "../../../apps/web/src/features/workbench/composer-draft-context.js";
import { ComposerDraftProvider as NativeDraft } from "../../src/features/workbench/composer-draft-context.js";
import { ProjectTodoProvider } from "../../../apps/web/src/features/workbench/project-todo-context.js";
import { ProjectDraftProvider } from "../../src/features/workbench/project-draft-context.js";
import { changeAppLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { i18n } from "../../src/i18n/i18n.js";
import type { WorkbenchComposerProps as WebProps } from "../../../apps/web/src/features/workbench/components/workbench-composer-contracts.js";
import type { WorkbenchComposerProps as NativeProps } from "../../src/features/workbench/components/workbench-composer-contracts.js";
import type { AcpConfigPreview } from "@codexly/protocol";
import "../../src/shared/styles/globals.css";
import "../../src/shared/styles/workbench.css";

vi.mock("../../../apps/web/src/features/access/access-context.js", async (original) => ({
  ...(await original()),
  useAccess: () => ({ status: { role: "owner" } }),
}));
it.each(["web", "native"] as const)(
  "%s 新建草稿协商原始配置并恢复失败的首次发送",
  async (platform) => {
    await changeAppLanguage("zh-CN");
    await i18n.changeLanguage("zh-CN");
    const projectId = `acp-new-${platform}`;
    sessionStorage.removeItem(`codexly:acp-draft:v1:${JSON.stringify([projectId, "draft"])}`);
    let finish!: (value: AcpConfigPreview) => void;
    const initial: AcpConfigPreview = {
      values: { raw: false },
      configOptions: [{ id: "raw", name: "原始开关", type: "boolean", currentValue: false }],
    };
    const preview = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({
        values: { raw: true },
        configOptions: [{ ...initial.configOptions[0]!, currentValue: true }],
      });
    const turn = {
      id: "turn-new",
      status: "running",
      items: [],
      startedAt: null,
      completedAt: null,
      error: null,
    };
    const task = {
      id: "task-new",
      projectId,
      title: "新任务",
      pinned: false,
      updatedAt: "2026-11-10T00:00:00Z",
      engine: "claude",
    };
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("配置暂时不可用"))
      .mockResolvedValue(
        platform === "web"
          ? {
              turn,
              taskId: task.id,
              createdTask: task,
              checkpoint: { sessionId: "s", sequence: 0 },
            }
          : turn,
      );
    const handoff = { checkpoint: { sessionId: "s", sequence: 7 }, snapshot: {
      ...task, runtime: "acp", status: "running", contextUsage: null, goal: null, plan: null,
      turns: [{ ...turn, items: [{ id: "reply", role: "assistant", type: "message", text: "首屏接管前的输出" }] }],
      pendingRequests: [], turnsNextCursor: null,
    } };
    const read = vi.fn().mockRejectedValueOnce(new Error("快照暂时不可用")).mockResolvedValue(handoff);
    const created = vi.fn(async () => task);
    const legacy = vi.fn();
    const started = vi.fn();
    const ref = createRef<{ submitCurrent(): Promise<boolean> }>();
    const client = {
      previewAcpConfig: preview,
      submitTask: submit,
      startConfiguredAcpPrompt: submit,
      createAcpTask: created,
      readTask: read,
      getAcpTask: read,
      listAcpQueuedSubmissions: async () => ({ data: [] }),
      getEngineProfile: legacy,
      readProviderConnection: legacy,
      submitPrompt: legacy,
    };
    const props = {
      client,
      composerRef: ref,
      capabilities: {
        runtime: "acp",
        provider: "claude",
        feedback: { upload: false },
        goals: { clear: false, read: false, update: false },
        skills: { list: false, use: false },
        tasks: { fork: false, list: true, read: true, start: true },
        turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
      },
      models: [],
      modelsPending: false,
      modelsError: null,
      skills: [],
      fastModeAvailable: false,
      fastModeDefault: false,
      followUpBehavior: "queue",
      onSettingsChange: legacy,
      onFastModeChange: legacy,
      onRequestNotificationPermission: vi.fn(),
      onOpenProjectPath: vi.fn(),
      onProjectRootChange: vi.fn(),
      onTaskStarted: started,
      projectId,
      projectName: "项目",
      projectPath: "/work",
      projectPathOpenDisabled: false,
      projectRoots: [],
      selectedProjectRootId: "",
      projectToolsEnabled: false,
      footerVisible: false,
      initialDraft: { content: [{ type: "text", text: "首次输入" }], attachments: [] },
      settings: {
        model: "old",
        reasoningEffort: "high",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxMode: "workspace-write",
      },
    };
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={query}>
        <TooltipProvider>
          <SelectedEnginesContext value={["claude"]}>
            {platform === "web" ? (
              <ProjectTodoProvider>
                <WebDraft>
                  <WebComposer {...(props as unknown as WebProps)} />
                </WebDraft>
              </ProjectTodoProvider>
            ) : (
              <ProjectDraftProvider>
                <NativeDraft>
                  <NativeComposer {...(props as unknown as NativeProps)} />
                </NativeDraft>
              </ProjectDraftProvider>
            )}
          </SelectedEnginesContext>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    // 等待真实懒加载入口挂载，不把模块首次下载计入配置调用的断言窗口。
    await screen.getByRole("button", { name: "输入配置", exact: true }).click();
    await expect.poll(() => preview.mock.calls.length).toBe(1);
    expect(created).not.toHaveBeenCalled();
    await expect(ref.current?.submitCurrent()).resolves.toBe(false);
    finish(initial);
    const editor = screen.getByRole("textbox");
    await expect.element(editor).toHaveValue("首次输入");
    await expect.element(screen.getByRole("checkbox", { name: "原始开关" })).not.toBeChecked();
    await expect(ref.current?.submitCurrent()).resolves.toBe(false);
    await expect.element(editor).toHaveValue("首次输入");
    await screen.getByRole("checkbox", { name: "原始开关" }).click();
    await expect.element(screen.getByRole("checkbox", { name: "原始开关" })).toBeChecked();
    await expect(ref.current?.submitCurrent()).resolves.toBe(false);
    expect(started).not.toHaveBeenCalled();
    await expect(ref.current?.submitCurrent()).resolves.toBe(true);
    expect(submit).toHaveBeenCalledTimes(3);
    const firstKey =
      platform === "web" ? submit.mock.calls[0]?.[2]?.idempotencyKey : submit.mock.calls[0]?.[3];
    const nextKey =
      platform === "web" ? submit.mock.calls[1]?.[2]?.idempotencyKey : submit.mock.calls[1]?.[3];
    expect(typeof firstKey).toBe("string");
    expect(typeof nextKey).toBe("string");
    expect(nextKey).not.toBe(firstKey);
    const input = { type: "prompt", text: "首次输入", attachments: [], skills: [] };
    const expected =
      platform === "web"
        ? [
            projectId,
            {
              type: "acp-prompt",
              engine: "claude",
              workspacePath: "/work",
              initialConfig: { raw: true },
              recoveryKey: firstKey,
              input,
            },
            { idempotencyKey: nextKey },
          ]
        : [projectId, "task-new", input, nextKey, { raw: true }, firstKey];
    expect(submit.mock.calls[1]).toEqual(expected);
    expect(submit.mock.calls[2]).toEqual(expected);
    const creationArgs = [
      projectId,
      "claude",
      { idempotencyKey: firstKey, workspacePath: "/work" },
    ];
    expect(created.mock.calls).toEqual(platform === "native" ? [creationArgs, creationArgs, creationArgs] : []);
    expect(started.mock.calls[0]?.slice(0, 5)).toEqual([
      task,
      expect.objectContaining({ id: "turn-new" }),
      input,
      undefined,
      [],
    ]);
    expect(started.mock.calls[0]?.[5]).toEqual(
      platform === "web" ? { sessionId: "s", sequence: 0 } : { sessionId: "s", sequence: 7 },
    );
    expect(started.mock.calls[0]?.[6]).toEqual(handoff);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(projectId, "task-new");
    expect(legacy).not.toHaveBeenCalled();
    await screen.unmount();
    query.clear();
  },
);
