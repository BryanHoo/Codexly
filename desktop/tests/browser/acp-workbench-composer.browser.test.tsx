import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { WorkbenchComposer } from "../../../apps/web/src/features/workbench/components/workbench-composer.js";
import type {
  WorkbenchComposerProps,
  WorkbenchComposerHandle,
} from "../../../apps/web/src/features/workbench/components/workbench-composer-contracts.js";
import { ComposerDraftProvider } from "../../../apps/web/src/features/workbench/composer-draft-context.js";
import { ProjectTodoProvider } from "../../../apps/web/src/features/workbench/project-todo-context.js";
import { changeAppLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { createTaskStore } from "../../../apps/web/src/features/conversation/runtime/task-store.js";
import { createResponse } from "../../../apps/web/src/features/conversation/runtime/task-store.test-support.js";
import { selectTaskRuntimeMetadata } from "@codexly/frontend-core/task-view-selectors";
import type { AcpSessionState } from "@codexly/protocol";
import "../../src/shared/styles/globals.css";
import "../../src/shared/styles/workbench.css";

vi.mock("../../../apps/web/src/features/access/access-context.js", async (original) => ({
  ...(await original()),
  useAccess: () => ({ status: { role: "owner" } }),
}));

async function renderComposer(fromCapability: boolean, continuation = false) {
  await changeAppLanguage("zh-CN");
  const initial: AcpSessionState = {
    configOptions: [
      {
        id: "native-model",
        name: "原生模型",
        type: "select",
        category: "model",
        currentValue: "one",
        options: [
          { value: "one", name: "模型一" },
          { value: "two", name: "模型二" },
        ],
      },
      { id: "native-switch", name: "原生布尔", type: "boolean", currentValue: false },
      {
        id: "reasoning_effort",
        name: "Reasoning effort",
        category: "thought_level",
        type: "select",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
    ],
    availableCommands: [],
  };
  const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
  const response = createResponse({ acpSession: initial });
  const { settings: _legacySettings, ...snapshot } = response.snapshot;
  store.getState().hydrate({ ...response, snapshot: { ...snapshot, runtime: "acp" } });
  let resolve!: (options: AcpSessionState["configOptions"]) => void;
  const config = vi.fn(
    () =>
      new Promise<AcpSessionState["configOptions"]>((done) => {
        resolve = done;
      }),
  );
  const submit = vi.fn(() =>
    Promise.resolve({
      taskId: continuation ? "continuation-1" : "task-1",
      ...(continuation ? { createdTask: {
        id: "continuation-1", title: "接续测试", projectId: "project-1", engine: "claude",
        updatedAt: "2026-11-26T00:00:00.000Z",
      } } : {}),
      checkpoint: { sequence: 1, sessionId: "s" },
      turn: {
        id: "new-turn",
        status: "running",
        items: [],
        startedAt: null,
        completedAt: null,
        error: null,
      },
    }),
  );
  const profile = vi.fn(),
    legacySettings = vi.fn();
  const client = {
    getAcpSessionState: vi.fn(),
    setAcpSessionConfig: config,
    ...(continuation ? {
      previewAcpConfig: vi.fn(async (_project, _engine, request) => {
        const values = request.change ? { [request.change.configId]: request.change.value } : (request.values ?? {});
        return { values, configOptions: [{
          id: "target-model", name: "目标模型", type: "select", category: "model",
          currentValue: "sonnet", options: [{ value: "sonnet", name: "Sonnet" }],
        }] };
      }),
      readTask: vi.fn(async () => ({ ...response, snapshot: { ...snapshot, id: "continuation-1", runtime: "acp" } })),
    } : {}),
    submitTask: submit,
    listQueuedSubmissions: () => Promise.resolve({ data: [] }),
    getEngineProfile: profile,
    readProviderConnection: profile,
  };
  const ref = createRef<WorkbenchComposerHandle>();
  const props: WorkbenchComposerProps = {
    client: client as unknown as WorkbenchComposerProps["client"],
    composerRef: ref,
    capabilities: {
      ...(fromCapability ? { runtime: "acp" as const } : {}),
      provider: "codex",
      feedback: { upload: false },
      goals: { clear: false, read: false, update: false },
      skills: { list: false, use: false },
      tasks: { fork: false, list: true, read: true, start: true },
      turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
    },
    fastModeAvailable: false,
    fastModeDefault: false,
    followUpBehavior: "queue",
    models: [],
    modelsPending: false,
    modelsError: null,
    initialDraft: { content: [{ type: "text", text: "未发送的草稿" }], attachments: [] },
    onSettingsChange: legacySettings,
    onFastModeChange: vi.fn(),
    onRequestNotificationPermission: vi.fn(),
    onOpenProjectPath: vi.fn(),
    onProjectRootChange: vi.fn(),
    onTaskStarted: vi.fn(),
    projectId: "project-1",
    projectPath: "/work",
    projectPathOpenDisabled: false,
    projectRoots: [],
    selectedProjectRootId: "",
    projectToolsEnabled: false,
    settings: undefined,
    skills: [],
    taskId: "task-1",
    footerVisible: false,
    runtime: {
      store,
      metadata: fromCapability ? undefined : selectTaskRuntimeMetadata(store.getState()),
      activeTurnId: undefined,
      connectionState: "connected",
      error: null,
      hasOlderHistory: false,
      isLoadingOlderHistory: false,
      isPending: false,
      itemStructureRevision: 0,
      loadOlderHistory: () => Promise.resolve(),
      olderHistoryError: null,
      readSnapshot: () => undefined,
    },
  };
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={query}>
      <TooltipProvider>
        <ProjectTodoProvider>
          <ComposerDraftProvider>
            <WorkbenchComposer {...props} />
          </ComposerDraftProvider>
        </ProjectTodoProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { screen, query, ref, props, config, submit, profile, legacySettings, initial, resolveConfig: (options: AcpSessionState["configOptions"]) => { resolve(options); } };
}

it.each([false, true])("实际输入框按任务元数据或运行时能力接入 ACP：%s", async (fromCapability) => {
  const { screen, query, ref, submit, profile, legacySettings, initial, resolveConfig } =
    await renderComposer(fromCapability);
  const editor = screen.getByRole("textbox");
  await expect.element(editor).toHaveValue("未发送的草稿");
  const node = editor.element();
  const reasoning = screen.getByRole("button", { name: "推理强度", exact: true });
  await expect.element(reasoning).toBeVisible();
  expect(document.querySelector("[data-composer-trailing]")?.contains(reasoning.element())).toBe(
    true,
  );
  expect(reasoning.element().getBoundingClientRect().right).toBeLessThanOrEqual(
    document.querySelector("[data-composer-actions]")!.getBoundingClientRect().left,
  );
  expect(
    screen
      .getByRole("button", { name: "添加图片或文件", exact: true })
      .element()
      .querySelector(".lucide-plus"),
  ).not.toBeNull();
  await expect
    .element(screen.getByRole("button", { name: "原生布尔", exact: true }))
    .toHaveTextContent("关闭");
  await screen.getByRole("button", { name: / \/ 模型一$/ }).click();
  await expect.element(screen.getByRole("tab", { name: "收藏", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("tab", { name: "Claude", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("option", { name: /模型二/ }).click();
  await expect(ref.current?.submitCurrent()).resolves.toBe(false);
  expect(submit).not.toHaveBeenCalled();
  resolveConfig([{ ...initial.configOptions[0]!, currentValue: "two" }]);
  await expect.element(screen.getByRole("button", { name: / \/ 模型二$/ })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "原生布尔", exact: true }))
    .not.toBeInTheDocument();
  expect(editor.element()).toBe(node);
  await expect.element(editor).toHaveValue("未发送的草稿");
  await expect(ref.current?.submitCurrent()).resolves.toBe(true);
  expect(submit).toHaveBeenCalledWith(
    "project-1",
    {
      type: "acp-prompt",
      taskId: "task-1",
      input: { type: "prompt", text: "未发送的草稿", attachments: [], skills: [] },
    },
    { idempotencyKey: expect.any(String) },
  );
  expect(profile).not.toHaveBeenCalled();
  expect(legacySettings).not.toHaveBeenCalled();
  await screen.unmount();
  query.clear();
});


it("跨 Agent 发送需确认，取消保留草稿，确认打开新任务", async () => {
  const { screen, query, ref, props, config, submit } = await renderComposer(false, true);
  const editor = screen.getByRole("textbox");
  await screen.getByRole("button", { name: / \/ 模型一$/ }).click();
  await screen.getByRole("tab", { name: "Claude", exact: true }).click();
  await screen.getByRole("option", { name: /Sonnet/ }).click();
  await expect.element(screen.getByRole("button", { name: "接续到 Claude", exact: true })).toBeVisible();
  const rejected = ref.current?.submitCurrent();
  await expect.element(screen.getByRole("alertdialog")).toBeVisible();
  expect(submit).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "取消", exact: true }).click();
  await expect(rejected).resolves.toBe(false);
  await expect.element(editor).toHaveValue("未发送的草稿");
  const confirmed = ref.current?.submitCurrent();
  await screen.getByRole("button", { name: "创建并发送", exact: true }).click();
  await expect(confirmed).resolves.toBe(true);
  expect(submit).toHaveBeenCalledExactlyOnceWith("project-1", expect.objectContaining({
    type: "acp-prompt", engine: "claude", continuationSourceTaskId: "task-1",
    initialConfig: { "target-model": "sonnet" },
    input: { type: "prompt", text: "未发送的草稿", attachments: [], skills: [] },
  }), { idempotencyKey: expect.any(String) });
  expect(config).not.toHaveBeenCalled();
  expect(props.onTaskStarted).toHaveBeenCalledWith(expect.objectContaining({ id: "continuation-1" }),
    expect.anything(), expect.anything(), undefined, [], expect.anything(), expect.anything());
  await screen.unmount();
  query.clear();
});
