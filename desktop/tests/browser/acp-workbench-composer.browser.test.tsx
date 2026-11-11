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

it.each([false, true])("实际输入框按任务元数据或运行时能力接入 ACP：%s", async (fromCapability) => {
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
      taskId: "task-1",
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
