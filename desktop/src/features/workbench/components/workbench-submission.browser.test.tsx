import type { AgentTaskSnapshot, AgentTurn } from "@/protocol/index.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useStore } from "zustand";

import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { selectTaskRuntimeMetadata } from "../../conversation/runtime/task-view-selectors.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { NativeWorkbenchClient } from "../../projects/project-queries.js";
import { ComposerDraftProvider } from "../composer-draft-context.js";
import { ProjectDraftProvider } from "../project-draft-context.js";
import type { WorkbenchComposerHandle } from "./workbench-composer.js";
import { ActiveTaskWorkbench } from "./workbench-shell-active-task.js";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

vi.mock("../hooks/use-workbench-branch-switch.js", () => ({
  useWorkbenchBranchSwitch: () => ({ worktrees: [] }),
}));

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const noop = () => {};
const settings = {
  model: "model", reasoningEffort: "high", approvalPolicy: "on-request",
  approvalsReviewer: "user", sandboxMode: "workspace-write",
} as const;

test.each([1280, 1920].flatMap((width) =>
  ["before-events", "before-user", "after-user", "assistant-before-user"].map((responseOrder) => ({ width, responseOrder })),
))("满屏历史通过真实 Composer 再次发送时不闪烁 ($width / $responseOrder)", async ({ width, responseOrder }) => {
  await page.viewport(width, 720);
  await i18n.changeLanguage("zh-CN");
  const snapshot: AgentTaskSnapshot = {
    id: "task", projectId: "temporary", title: "历史任务", pinned: false,
    updatedAt: "2026-09-12T00:00:00Z", status: "idle", settings,
    goal: null, plan: null, contextUsage: null, pendingRequests: [], turnsNextCursor: null,
    turns: [...Array.from({ length: 19 }, (_, index): AgentTurn => ({
      id: `older-${index}`, status: "completed", error: null,
      startedAt: "2026-09-12T00:00:00Z", completedAt: "2026-09-12T00:00:01Z",
      items: [{ id: "answer", type: "message", role: "assistant",
        text: `更早回合 ${index}\n\n${"历史回答。\n\n".repeat(24)}` }],
    })), {
      id: "history", status: "completed", error: null,
      startedAt: "2026-09-12T00:00:00Z", completedAt: "2026-09-12T00:00:01Z",
      items: [
        { id: "user", type: "message", role: "user", text: "历史问题" },
        { id: "answer", type: "message", role: "assistant",
          text: Array.from({ length: 24 }, (_, index) => `历史段落 ${index}：这段回答已经占满聊天区域。`).join("\n\n") },
      ],
    }],
  };
  const store = createTaskStore({ projectId: snapshot.projectId, taskId: snapshot.id }, {
    checkpoint: { sequence: 0, sessionId: "session" }, snapshot,
  });
  store.getState().setConnectionState("connected");
  store.getState().setWriteAccess("writable");
  const nextTurn: AgentTurn = {
    id: "next", status: "running", startedAt: new Date().toISOString(),
    completedAt: null, error: null, items: [],
  };
  let resolveStart = () => {};
  const startTurn = vi.fn(() => new Promise((resolve) => {
    resolveStart = () => resolve({ taskId: snapshot.id, turn: nextTurn,
      checkpoint: { sequence: 0, sessionId: "session" } });
  }));
  const client = {
    submitPrompt: startTurn, listQueuedSubmissions: async () => ({ data: [] }),
  } as unknown as NativeWorkbenchClient;
  const composerRef = createRef<WorkbenchComposerHandle>();
  function Harness() {
    const state = useStore(store);
    const runtime: TaskRuntimeView = {
      store, activeTurnId: state.turnIds.find((id) => state.turnsById[id]?.status === "running"),
      connectionState: state.connectionState, writeAccess: state.writeAccess, error: null,
      hasOlderHistory: false, isLoadingOlderHistory: false, isPending: false,
      itemStructureRevision: state.itemStructureRevision,
      loadOlderHistory: async () => {}, olderHistoryError: null,
      metadata: selectTaskRuntimeMetadata(state), readSnapshot: state.reconstructSnapshot,
    };
    return <div className="flex flex-col" style={{ height: 660, width: width - 560 }}>
      <ActiveTaskWorkbench
        capabilities={{ provider: "codex", feedback: { upload: false },
          goals: { clear: false, read: false, update: false }, skills: { list: false, use: false },
          tasks: { fork: false, list: true, read: true, start: true },
          turns: { compact: false, interrupt: true, review: false, start: true, steer: true } }}
        client={client} composerRef={composerRef} runtime={runtime}
        fallbackSettings={settings} fastModeAvailable={false} fastModeDefault={false}
        followUpBehavior="queue" models={[{ id: "model", displayName: "Model", description: "",
          isDefault: true, defaultReasoningEffort: "high", inputModalities: ["text"],
          supportedReasoningEfforts: [{ id: "high", description: "" }] }]}
        modelsError={null} modelsPending={false} onProjectTaskDefaultsChange={async () => {}}
        onOpenProjectPath={noop} onProjectRootChange={noop} onTaskStarted={noop}
        projectId="temporary" projectName="项目" projectPath="/work" projectPathOpenDisabled={false}
        projectRoots={[]} projectToolsEnabled={false} selectedProjectRootId="" skills={[]}
        startingSnapshot={undefined} startingPrompt={undefined} taskId="task"
        onOpenFileDiff={noop} onOpenSourceFile={noop} onReviewFileChanges={noop}
      />
    </div>;
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(<QueryClientProvider client={queryClient}><TooltipProvider>
    <ProjectDraftProvider><ComposerDraftProvider><Harness /></ComposerDraftProvider></ProjectDraftProvider>
  </TooltipProvider></QueryClientProvider>);
  const editor = screen.getByRole("textbox");
  await editor.fill("继续回答");
  const container = screen.getByRole("log").element();
  const historyAnchor = screen.getByText("历史段落 23：这段回答已经占满聊天区域。", { exact: true });
  await expect.element(historyAnchor).toBeVisible();
  await expect.poll(() => container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);
  expect(container.scrollHeight).toBeGreaterThan(container.clientHeight);
  const anchor = historyAnchor.element();
  const historyRow = anchor.closest<HTMLElement>('[data-virtual-row="turn"]')!;
  await expect.poll(() => Math.abs(container.getBoundingClientRect().bottom - historyRow.getBoundingClientRect().bottom - 28)).toBeLessThanOrEqual(1);
  const samples: number[] = [anchor.getBoundingClientRect().top];
  const overlaps: number[] = [];
  let userHasAppeared = false;
  let firstUserMessage: HTMLElement | undefined;
  const replacedUserFrames: boolean[] = [];
  const missingUserFrames: boolean[] = [];
  const detachedRunningFrames: boolean[] = [];
  const initialUserOffsets: number[] = [];
  let assistantStarted = false;
  let sampling = true;
  const sample = async () => {
    while (sampling) {
      await nextFrame();
      // 等待本帧布局与 ResizeObserver 完成，检查真正交给绘制的行位置。
      await new Promise((resolve) => setTimeout(resolve, 0));
      samples.push(anchor.getBoundingClientRect().top);
      const lastTurn = container.querySelector<HTMLElement>('[data-virtual-row="turn"]:has([data-conversation-anchor*="next"])');
      const userMessage = lastTurn?.querySelector<HTMLElement>('[data-role="user"]');
      if (userMessage !== undefined && userMessage !== null) userHasAppeared = true;
      if (userMessage !== undefined && userMessage !== null) {
        firstUserMessage ??= userMessage;
        replacedUserFrames.push(userMessage !== firstUserMessage);
        const runningLabel = i18n.t("timeline.aiRunning", { ns: "conversation" });
        // 消息首次可见时，运行提示必须已在同一测量行内，不能等待独立尾部补占高度。
        detachedRunningFrames.push(!Array.from(lastTurn!.querySelectorAll("[aria-label]"))
          .some((element) => element.getAttribute("aria-label") === runningLabel));
        if (!assistantStarted) {
          initialUserOffsets.push(container.getBoundingClientRect().bottom - userMessage.getBoundingClientRect().bottom);
        }
      }
      if (userHasAppeared) {
        const rect = userMessage?.getBoundingClientRect();
        const viewport = container.getBoundingClientRect();
        missingUserFrames.push(rect === undefined || rect.bottom <= viewport.top || rect.top >= viewport.bottom);
      }
      const footer = container.querySelector<HTMLElement>('[data-virtual-row="footer"]');
      if (lastTurn !== null && footer !== null) {
        overlaps.push(lastTurn.getBoundingClientRect().bottom - footer.getBoundingClientRect().top);
      }
    }
  };
  const samplingDone = sample();
  const assertSingleRunningStatus = () => {
    const label = i18n.t("timeline.aiRunning", { ns: "conversation" });
    expect(Array.from(container.querySelectorAll("[aria-label]"))
      .filter((element) => element.getAttribute("aria-label") === label)).toHaveLength(1);
  };
  try {
    await screen.getByRole("button", { name: i18n.t("composer.submit", { ns: "workbench" }), exact: true }).click();
    expect(startTurn).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 8; index += 1) await nextFrame();
    if (responseOrder === "before-events") {
      resolveStart();
      for (let index = 0; index < 8; index += 1) await nextFrame();
    }
    // 实际事件流可以早于 turn/start 响应，新回合此时尚无用户 Item。
    store.getState().applyEvents([{
      version: 2, provider: "codex", sessionId: "session", sequence: 1,
      taskId: snapshot.id, turnId: nextTurn.id, timestamp: nextTurn.startedAt!,
      type: "turn.started", payload: { turn: nextTurn },
    }]);
    for (let index = 0; index < 8; index += 1) await nextFrame();
    assertSingleRunningStatus();
    if (responseOrder === "before-user" || responseOrder === "assistant-before-user") {
      resolveStart();
      for (let index = 0; index < 8; index += 1) await nextFrame();
    }
    if (responseOrder === "assistant-before-user") {
      assistantStarted = true;
      store.getState().applyEvents([{
        version: 2, provider: "codex", sessionId: "session", sequence: 2,
        taskId: snapshot.id, turnId: nextTurn.id, itemId: "next-assistant", timestamp: nextTurn.startedAt!,
        type: "item.started", payload: { item: { id: "next-assistant", type: "message", role: "assistant", text: "继续处理" } },
      }]);
      for (let index = 0; index < 8; index += 1) await nextFrame();
    }
    store.getState().applyEvents([{
      version: 2, provider: "codex", sessionId: "session", sequence: 3,
      taskId: snapshot.id, turnId: nextTurn.id, itemId: "next-user", timestamp: nextTurn.startedAt!,
      type: "item.started", payload: { item: { id: "next-user", type: "message", role: "user", text: "继续回答" } },
    }]);
    for (let index = 0; index < 8; index += 1) await nextFrame();
    assertSingleRunningStatus();
    if (responseOrder === "after-user") resolveStart();
    for (let index = 0; index < 16; index += 1) await nextFrame();
    assertSingleRunningStatus();
  } finally {
    sampling = false;
    await samplingDone;
  }
  expect(anchor.isConnected).toBe(true);
  expect(userHasAppeared).toBe(true);
  expect.soft(replacedUserFrames).not.toContain(true);
  expect.soft(missingUserFrames).not.toContain(true);
  expect.soft(detachedRunningFrames).not.toContain(true);
  // 回复内容尚未增长时，首次出现的输入不能再因时间或运行态补位向上跳动。
  expect.soft(Math.max(...initialUserOffsets) - Math.min(...initialUserOffsets)).toBeLessThanOrEqual(1);
  expect.soft(overlaps.every((overlap) => overlap <= 0)).toBe(true);
  expect(Math.max(...samples.slice(1).map((top, index) => top - samples[index]!))).toBeLessThan(1);
  expect(container.scrollHeight - container.scrollTop - container.clientHeight).toBeLessThan(1);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  // 持续输出时必须能点击并编辑下一条草稿，不能依赖切换任务恢复焦点。
  const editorNode = editor.element() as HTMLTextAreaElement;
  await expect.poll(() => editorNode.disabled).toBe(false);
  let sequence = 4;
  store.getState().applyEvents([{
    version: 2, provider: "codex", sessionId: "session", sequence: sequence++,
    taskId: snapshot.id, turnId: nextTurn.id, itemId: "stream-focus", timestamp: nextTurn.startedAt!,
    type: "item.started", payload: { item: { id: "stream-focus", type: "message", role: "assistant", text: "流式回答" } },
  }]);
  for (let batch = 0; batch < 12; batch += 1) {
    store.getState().applyEvents([{
      version: 2, provider: "codex", sessionId: "session", sequence: sequence++,
      taskId: snapshot.id, turnId: nextTurn.id, itemId: "stream-focus", timestamp: nextTurn.startedAt!,
      type: "message.delta", payload: { delta: `\n\n流式段落 ${batch}：${"持续输出内容。".repeat(80)}` },
    }]);
    await nextFrame();
    await nextFrame();
    await expect.element(screen.getByText(`流式段落 ${batch}：${"持续输出内容。".repeat(80)}`, { exact: true })).toBeVisible();
    editorNode.blur();
    const rect = editorNode.getBoundingClientRect();
    expect(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)).toBe(editorNode);
    await editor.click();
    expect(document.activeElement).toBe(editorNode);
    await editor.fill(`未发送草稿 ${batch}`);
    await nextFrame();
    expect(document.activeElement).toBe(editorNode);
    expect(editorNode.value).toBe(`未发送草稿 ${batch}`);
  }
});
