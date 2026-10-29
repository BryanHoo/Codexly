import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import type { ProjectRuntimeManager } from "../../conversation/runtime/project-runtime.js";
import { SubagentOutputDialog } from "./subagent-output-dialog.js";
import "../../../shared/styles/globals.css";

const { runtimeMock } = vi.hoisted(() => ({ runtimeMock: vi.fn() }));
vi.mock("../../conversation/runtime/use-task-runtime.js", () => ({ useTaskRuntime: runtimeMock }));

test.each([false, true])(
  "右栏使用同一弹窗，增量输出跟随且上滚可暂停（内嵌：%s）",
  async (embedded) => {
    const report = (count: number) => ({
      id: "report",
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
    const taskId = embedded ? "parent" : "child";
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
                : [{ id: "initial", type: "message", role: "user", text: "分析缓存" }, report(40)],
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
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              setOpen(true);
            }}
          >
            打开右栏子代理
          </button>
          <SubagentOutputDialog
            projectId="project"
            projectRuntime={{} as ProjectRuntimeManager}
            onClose={() => setOpen(false)}
            selection={
              open
                ? {
                    taskId: "child",
                    status: "running",
                    ...(embedded ? { embedded: { parentTaskId: "parent", itemId: "spawn" } } : {}),
                  }
                : null
            }
          />
        </>
      );
    }
    const screen = await render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开右栏子代理" });
    await trigger.click();
    const dialog = screen.getByRole("dialog").element();
    expect(dialog.classList.contains("agent-operation-detail-dialog")).toBe(true);
    await expect.element(screen.getByText("分析缓存", { exact: true })).toBeVisible();
    expect(dialog.querySelector('[data-slot="message-scroller-viewport"]')).toBeNull();
    const viewport = dialog.querySelector<HTMLElement>("[data-operation-detail-body]")!;
    const gap = () => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    await expect.poll(gap).toBeLessThanOrEqual(1);
    const itemStore = [...store.getState().itemStoresByKey.values()].find(
      (item) => item.peek().id === (embedded ? "spawn" : "report"),
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
    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveFocus();
  },
);
