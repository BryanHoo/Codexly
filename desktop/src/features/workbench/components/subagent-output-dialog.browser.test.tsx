import { acpSubagentItemPrefix, type AgentItem } from "@codexly/protocol";
import { useState } from "react";
import { expect, onTestFinished, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import type { ProjectRuntimeManager } from "../../conversation/runtime/project-runtime.js";
import { collectSubagents, type SubagentSelection } from "./subagent.js";
import { SubagentSection } from "./workbench-inspector-sections.js";
import { useInspectorTask } from "./use-inspector-task.js";
import { SubagentOutputDialog } from "./subagent-output-dialog.js";
import "../../../shared/styles/globals.css";

const { runtimeMock } = vi.hoisted(() => ({ runtimeMock: vi.fn() }));
vi.mock("../../conversation/runtime/use-task-runtime.js", () => ({ useTaskRuntime: runtimeMock }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string, protocol: string) => `http://${protocol}.localhost/${path}`,
}));

test.each(["独立", "内嵌", "ACP"] as const)(
  "%s 子代理复用右栏弹窗，增量输出跟随且上滚可暂停",
  async (kind) => {
    const acp = kind === "ACP";
    const embedded = kind === "内嵌";
    const prefix = acpSubagentItemPrefix("child");
    const acpAnnouncement: AgentItem = {
      id: prefix,
      type: "acp_subagent",
      parentSessionId: "session",
      sessionId: "child",
      title: "研究员",
      state: "running",
    };
    const readTool: AgentItem = {
      id: prefix + "acp:tool:read",
      type: "tool",
      name: "Read src/cache.ts",
      status: "completed",
      input: "…",
      output: "…",
      outputAttachments: [
        {
          id: "history-read-input",
          name: "工具输入-1.txt",
          size: 18,
          kind: "text",
          mediaType: "text/plain",
        },
        {
          id: "history-read-output",
          name: "工具输出-1.txt",
          size: 81,
          kind: "text",
          mediaType: "text/plain",
        },
      ],
    };
    const report = (count: number) => ({
      id: acp ? prefix + "report" : "report",
      type: "message" as const,
      role: "assistant" as const,
      text: "正在读取文件。\n\n".repeat(count),
    });
    const makeSpawn = (count: number) => ({
      id: "spawn",
      type: "tool" as const,
      name: "agent/spawn",
      status: "running" as const,
      input: { prompt: "分析缓存", model: "test-model" },
      output: {
        parentTaskId: "parent",
        agents: [{ taskId: "child", nickname: "研究员", status: "running" }],
        turn: {
          id: "child-turn",
          status: "running",
          items: [
            { id: "initial", type: "message", role: "user", text: "分析缓存" },
            report(count),
          ],
        },
      },
    });
    const taskId = embedded || acp ? "parent" : "child";
    const store = createTaskStore(
      { projectId: "project", taskId },
      {
        checkpoint: { sequence: 0, sessionId: "session" },
        snapshot: {
          id: taskId,
          projectId: "project",
          title: "研究员",
          pinned: false,
          status: "running",
          pendingRequests: [],
          updatedAt: "2026-10-29T00:00:00Z",
          contextUsage: null,
          goal: null,
          plan: null,
          turnsNextCursor: null,
          settings: {
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            model: "test-model",
            reasoningEffort: "high",
            sandboxMode: "workspace-write",
          },
          turns: [
            {
              id: "turn",
              status: "running",
              startedAt: "2026-10-29T00:00:00Z",
              completedAt: null,
              error: null,
              items: embedded
                ? [makeSpawn(40)]
                : [
                    ...(acp ? [acpAnnouncement, readTool] : []),
                    {
                      id: acp ? prefix + "initial" : "initial",
                      type: "message",
                      role: "user",
                      text: "分析缓存",
                    },
                    report(40),
                  ],
            },
          ],
        },
      },
    );
    runtimeMock.mockReturnValue({
      error: null,
      isPending: false,
      metadata: store.getState().snapshotMetadata,
      store,
      hasOlderHistory: false,
    });
    function Harness() {
      const [selection, setSelection] = useState<SubagentSelection | null>(null);
      const inspectorTask = useInspectorTask(store, acp, undefined);
      return (
        <>
          {acp ? (
            <SubagentSection
              subagents={collectSubagents(inspectorTask, taskId)}
              onOpenSubagent={setSelection}
            />
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                setSelection({
                  taskId: "child",
                  status: "running",
                  ...(embedded ? { embedded: { parentTaskId: "parent", itemId: "spawn" } } : {}),
                });
              }}
            >
              打开右栏子代理
            </button>
          )}
          <SubagentOutputDialog
            projectId="project"
            projectRuntime={{} as ProjectRuntimeManager}
            onClose={() => setSelection(null)}
            selection={selection}
          />
        </>
      );
    }
    const screen = await render(<Harness />);
    const trigger = screen.getByRole("button", {
      name: acp ? /研究员/ : "打开右栏子代理",
    });
    await trigger.click();
    // 首次打开按需下载共享浮层，等待可见后再读取真实布局。
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    expect(runtimeMock.mock.calls.at(-1)?.[1]).toBe(taskId);
    const dialog = screen.getByRole("dialog").element();
    expect(dialog.classList.contains("agent-operation-detail-dialog")).toBe(true);
    await expect.element(screen.getByText("分析缓存", { exact: true })).toBeVisible();
    expect(dialog.querySelector('[data-slot="message-scroller-viewport"]')).toBeNull();
    const viewport = dialog.querySelector<HTMLElement>("[data-operation-detail-body]")!;
    const gap = () => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    await expect.poll(gap).toBeLessThanOrEqual(1);
    const itemStore = [...store.getState().itemStoresByKey.values()].find(
      (item) => item.peek().id === (embedded ? "spawn" : report(1).id),
    )!;
    const append = (count: number) => {
      itemStore.replace(embedded ? makeSpawn(count) : report(count));
      itemStore.publish();
    };
    const initialHeight = viewport.scrollHeight;
    append(60);
    await expect.poll(() => viewport.scrollHeight).toBeGreaterThan(initialHeight);
    await expect.poll(gap).toBeLessThanOrEqual(1);
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -300 }));
    viewport.scrollTop -= 300;
    viewport.dispatchEvent(new Event("scroll"));
    const readingTop = viewport.scrollTop;
    const readingHeight = viewport.scrollHeight;
    append(80);
    await expect.poll(() => viewport.scrollHeight).toBeGreaterThan(readingHeight);
    expect(viewport.scrollTop).toBeCloseTo(readingTop, 0);
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event("scroll"));
    append(100);
    await expect.poll(gap).toBeLessThanOrEqual(1);
    if (acp) await expectStoredToolDetails(screen);
    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveFocus();
  },
);

async function expectStoredToolDetails(screen: Awaited<ReturnType<typeof render>>) {
  const originalFetch = globalThis.fetch;
  const request = vi.fn(async (url: URL) => {
    expect(url.searchParams.get("taskId")).toBe("parent");
    expect(url.searchParams.get("projectId")).toBe("project");
    expect(url.searchParams.get("acp")).toBe("1");
    return url.searchParams.get("attachmentId") === "history-read-input"
      ? new Response('{"offset":125}')
      : new Response("", { status: 404 });
  });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
    typeof input === "string" && input.startsWith("http://task-attachment.localhost/")
      ? request(new URL(input))
      : originalFetch(input, init),
  );
  onTestFinished(() => {
    fetchMock.mockRestore();
  });
  const read = screen.getByRole("button", { name: /Read src\/cache\.ts/u });
  expect(request).not.toHaveBeenCalled();
  await read.click();
  await expect.element(screen.getByText(/"offset": 125/u)).toBeVisible();
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect.element(screen.getByRole("link", { name: /工具输出-1.txt/u })).toBeVisible();
  await expect.element(screen.getByText("…", { exact: true })).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
}
