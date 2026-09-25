import type { AgentModel, AgentTaskSettings } from "@/protocol/index.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import { ComposerDraftProvider } from "../composer-draft-context.js";
import { createProjectDraftStore } from "../project-draft-store.js";
import { createComposerTurnOptions } from "./workbench-composer-contracts.js";
import { useComposerSession } from "./workbench-composer-session.js";

const settings: AgentTaskSettings = {
  model: "default-model", reasoningEffort: "low", approvalPolicy: "on-request",
  approvalsReviewer: "user", sandboxMode: "workspace-write",
};
const models: AgentModel[] = ["default-model", "thread-model"].map((id) => ({
  id, displayName: id, description: "", isDefault: id === "default-model",
  inputModalities: ["text"], defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["low", "medium", "high"].map((effort) => ({ id: effort, description: effort })),
}));
const client = {} as Parameters<typeof useComposerSession>[0]["client"];
const projectDraftStore = createProjectDraftStore();

function runtime(model: string | null, reasoningEffort: string | null): TaskRuntimeView {
  return {
    activeTurnId: undefined, connectionState: "connected", error: null,
    hasOlderHistory: false, isLoadingOlderHistory: false, isPending: false,
    itemStructureRevision: 0, loadOlderHistory: async () => undefined,
    olderHistoryError: null, readSnapshot: () => undefined, store: undefined,
    metadata: {
      id: "task-a", settings, threadConfiguration: { model, reasoningEffort },
      contextUsage: null, goal: null, status: "idle",
      title: "任务",
    },
  };
}

function Harness({ currentRuntime, onSend }: Readonly<{
  currentRuntime: TaskRuntimeView;
  onSend: (settings: AgentTaskSettings) => void;
}>) {
  const session = useComposerSession({
    capabilities: undefined, composerDraftId: undefined, client,
    editingProjectDraftId: undefined, gitStatus: undefined, models,
    initialDraft: undefined, onSubmissionStateChange: undefined,
    projectId: "project-a", projectPath: "/work", projectToolsEnabled: false,
    projectDraftStore, runtime: currentRuntime, settings, skills: [], taskId: currentRuntime.metadata?.id,
  });
  return <>
    <output>{session.selectedModel?.id}:{session.selectedReasoningEffort}</output>
    <button onClick={() => session.setSettingsOverride({ scope: session.routeScope, settings })}>手动选择</button>
    <button onClick={() => onSend(createComposerTurnOptions(
      session.activeSettings, session.selectedModel!.id, session.selectedReasoningEffort, undefined, false,
    ))}>发送</button>
  </>;
}

test("restores thread model and effort into the next submission, preserving manual changes on refresh", async () => {
  const onSend = vi.fn();
  const queryClient = new QueryClient();
  const view = (currentRuntime: TaskRuntimeView) => <QueryClientProvider client={queryClient}>
    <ComposerDraftProvider><Harness currentRuntime={currentRuntime} onSend={onSend} /></ComposerDraftProvider>
  </QueryClientProvider>;
  const screen = await render(view(runtime("thread-model", "high")));
  await expect.element(screen.getByText("thread-model:high", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "发送" }).click();
  expect(onSend).toHaveBeenLastCalledWith({ ...settings, model: "thread-model", reasoningEffort: "high" });
  await screen.getByRole("button", { name: "手动选择" }).click();
  await screen.rerender(view(runtime("thread-model", "medium")));
  await expect.element(screen.getByText("default-model:low", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "发送" }).click();
  expect(onSend).toHaveBeenLastCalledWith(settings);
  const nextRuntime = runtime("thread-model", "high");
  await screen.rerender(view({ ...nextRuntime, metadata: { ...nextRuntime.metadata!, id: "task-b" } }));
  await expect.element(screen.getByText("thread-model:high", { exact: true })).toBeVisible();
});

test.each([
  [null, null, "default-model:low"],
  ["thread-model", "unsupported", "thread-model:medium"],
  ["unavailable-model", "high", "default-model:high"],
] as const)("validates restored model availability and effort (%s, %s)", async (model, effort, expected) => {
  const screen = await render(<QueryClientProvider client={new QueryClient()}>
    <ComposerDraftProvider><Harness currentRuntime={runtime(model, effort)} onSend={vi.fn()} /></ComposerDraftProvider>
  </QueryClientProvider>);
  await expect.element(screen.getByText(expected, { exact: true })).toBeVisible();
});
