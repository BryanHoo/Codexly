import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { WorkbenchComposer } from "../../src/features/workbench/components/workbench-composer.js";
import type {
  WorkbenchComposerProps,
  WorkbenchComposerHandle,
} from "../../src/features/workbench/components/workbench-composer-contracts.js";
import { ComposerDraftProvider } from "../../src/features/workbench/composer-draft-context.js";
import { ProjectDraftProvider } from "../../src/features/workbench/project-draft-context.js";
import { i18n } from "../../src/i18n/i18n.js";
import { createTaskStore } from "../../src/features/conversation/runtime/task-store.js";
import { createResponse } from "../../../apps/web/src/features/conversation/runtime/task-store.test-support.js";
import { selectTaskRuntimeMetadata } from "@codexly/frontend-core/task-view-selectors";
import type { AcpSessionState } from "@codexly/protocol";
import "../../src/shared/styles/globals.css";
import "../../src/shared/styles/workbench.css";

it.each([false, true])("实际输入框按任务元数据或运行时能力接入 ACP：%s", async (fromCapability) => {
  await i18n.changeLanguage("zh-CN");
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
      id: "new-turn",
      status: "running",
      items: [],
      startedAt: null,
      completedAt: null,
      error: null,
    }),
  );
  const profile = vi.fn(),
    legacySettings = vi.fn();
  const cancel = vi.fn(async () => null),
    add = vi.fn(async () => ({
      queuedSubmission: {
        id: "q",
        status: "queued",
        text: "排队消息",
        skills: [],
        attachments: [],
        clientUserMessageId: "m",
      },
    })),
    legacy = vi.fn();
  const client = {
    interruptAcpTurn: cancel,
    addAcpQueuedSubmission: add,
    interruptTurn: legacy,
    addQueuedSubmission: legacy,
    steerTurn: legacy,
    submitPrompt: legacy,
    getAcpSessionState: vi.fn(),
    setAcpSessionConfig: config,
    startConfiguredAcpPrompt: submit,
    listAcpQueuedSubmissions: () => Promise.resolve({ data: [] }),
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
      turns: { compact: false, interrupt: true, review: false, start: true, steer: true },
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
    onOpenProjectPath: vi.fn(),
    onProjectRootChange: vi.fn(),
    onTaskStarted: vi.fn(),
    projectId: "project-1",
    projectName: "项目",
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
      writeAccess: "writable",
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
        <ProjectDraftProvider>
          <ComposerDraftProvider>
            <WorkbenchComposer {...props} />
          </ComposerDraftProvider>
        </ProjectDraftProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const editor = screen.getByRole("textbox");
  await expect.element(editor).toHaveValue("未发送的草稿");
  const node = editor.element();
  await screen.getByRole("button", { name: "输入配置", exact: true }).click();
  await expect.element(screen.getByRole("checkbox", { name: "原生布尔" })).not.toBeChecked();
  await screen.getByRole("combobox", { name: "原生模型" }).selectOptions("two");
  await expect(ref.current?.submitCurrent()).resolves.toBe(false);
  expect(submit).not.toHaveBeenCalled();
  resolve([{ ...initial.configOptions[0]!, currentValue: "two" }]);
  await expect.element(screen.getByRole("combobox", { name: "原生模型" })).toHaveValue("two");
  await expect.element(screen.getByRole("checkbox", { name: "原生布尔" })).not.toBeInTheDocument();
  expect(editor.element()).toBe(node);
  await expect.element(editor).toHaveValue("未发送的草稿");
  submit.mockRejectedValueOnce(new Error("暂时断开"));
  await expect(ref.current?.submitCurrent()).resolves.toBe(false);
  await expect.element(editor).toHaveValue("未发送的草稿");
  await expect(ref.current?.submitCurrent()).resolves.toBe(true);
  expect(submit.mock.calls[0]).toEqual(submit.mock.calls[1]);
  expect(submit).toHaveBeenCalledWith(
    "project-1",
    "task-1",
    { type: "prompt", text: "未发送的草稿", attachments: [], skills: [] },
    expect.any(String),
  );
  await screen.getByRole("button", { name: "输入配置", exact: true }).click();
  await screen.getByRole("button", { name: "停止", exact: true }).click();
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith("project-1", "task-1", "new-turn"));
  await editor.fill("排队消息");
  await expect(ref.current?.submitCurrent()).resolves.toBe(true);
  expect(add).toHaveBeenCalledWith(
    "project-1",
    "task-1",
    { type: "prompt", text: "排队消息", skills: [], attachments: [] },
    expect.any(String),
    { idempotencyKey: expect.any(String) },
  );
  expect(legacy).not.toHaveBeenCalled();
  expect(profile).not.toHaveBeenCalled();
  expect(legacySettings).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "输入配置", exact: true }).click();
  await screen.rerender(
    <QueryClientProvider client={query}>
      <TooltipProvider>
        <ProjectDraftProvider>
          <ComposerDraftProvider>
            <WorkbenchComposer
              {...props}
              runtime={{ ...props.runtime!, writeAccess: "external" }}
            />
          </ComposerDraftProvider>
        </ProjectDraftProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await expect.element(screen.getByRole("combobox", { name: "原生模型" })).toBeDisabled();
  await screen.unmount();
  query.clear();
});
