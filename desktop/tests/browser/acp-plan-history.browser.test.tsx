import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScheduledTasksContainer as Web } from "../../../apps/web/src/features/scheduled-tasks/scheduled-tasks-container.js";
import { ScheduledTasksContainer as Native } from "../../src/features/scheduled-tasks/scheduled-tasks-container.js";
import "../../src/shared/styles/globals.css";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as nativeLanguage } from "../../src/i18n/i18n.js";
const run = (runId: string, status: string, taskId: string | null = null) => ({
  runId,
  status,
  taskId,
  claimedAt: 10,
  definitionRevision: 3,
  error: status === "unknown" ? "无法确认" : status === "failed" ? "明确拒绝" : null,
});
function fixture() {
  const task = { id: "task/id", projectId: "p" };
  const client = {
    subscribeAcpPlans: vi.fn(() => () => {}),
    listAcpPlans: vi.fn(async () => ({
      data: [
        { scheduleId: "plan/id", name: "巡检", projectId: "p", engine: "claude", nextRunAt: null },
      ],
      nextCursor: null,
    })),
    readAcpPlanHistory: vi.fn(async () => ({
      projectId: "p",
      data: [
        run("d", "claimed"),
        run("c", "unknown"),
        run("b", "failed"),
        run("a", "started", "task/id"),
      ],
    })),
    readNavigableTask: vi.fn(async () => ({ task })),
    readTask: vi.fn(async () => task),
    listTasks: vi.fn(async () => ({ data: [], nextCursor: null })),
  };
  const navigate = vi.fn();
  const cache = new QueryClient();
  return {
    client,
    navigate,
    cache,
    context: {
      client,
      capabilities: { runtime: "acp" },
      projects: [],
      t: () => "任务已不可用",
      navigate,
    },
  };
}
beforeEach(async () => {
  await page.viewport(390, 844);
  await webLanguage("zh-CN");
  await nativeLanguage("zh-CN");
});
for (const [name, Container] of [
  ["Web", Web],
  ["Native", Native],
] as const) {
  it(`${name} 历史按需读取且区分启动阶段，窄屏能打开原任务并缓存快照`, async () => {
    const h = fixture();
    const screen = await render(
      <QueryClientProvider client={h.cache}>
        <Container {...({ context: h.context, projectId: "p", temporary: false } as never)} />
      </QueryClientProvider>,
    );
    expect(h.client.readAcpPlanHistory).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "运行记录", exact: true }).click();
    await expect.element(screen.getByText("待确认", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("已启动", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("准备启动", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("启动失败", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("无法确认", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("明确拒绝", { exact: true })).toBeVisible();
    expect(h.client.readAcpPlanHistory).toHaveBeenCalledWith(
      "plan/id",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const dialog = screen.getByRole("dialog");
    await expect
      .poll(() => dialog.element().scrollWidth - dialog.element().clientWidth)
      .toBeLessThanOrEqual(1);
    await screen.getByRole("button", { name: "打开任务", exact: true }).click();
    await expect.poll(() => h.navigate.mock.calls.length).toBe(1);
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/p/$projectId/t/$taskId",
      params: { projectId: "p", taskId: "task/id" },
    });
    expect(h.cache.getQueryData(["projects", "p", "tasks", "task/id"])).toEqual({
      id: "task/id",
      projectId: "p",
    });
    await screen.unmount();
  });
  it(`${name} 不可导航任务保留历史并提示，刷新失败可重试，关闭丢弃迟到历史`, async () => {
    const h = fixture();
    h.client.readNavigableTask.mockResolvedValue({ task: null } as never);
    h.client.listTasks.mockResolvedValue({ data: [{ id: "task/id" }], nextCursor: null } as never);
    const screen = await render(
      <QueryClientProvider client={h.cache}>
        <Container {...({ context: h.context, projectId: "p", temporary: false } as never)} />
      </QueryClientProvider>,
    );
    await screen.getByRole("button", { name: "运行记录", exact: true }).click();
    await screen.getByRole("button", { name: "打开任务", exact: true }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("任务已不可用");
    expect(h.navigate).not.toHaveBeenCalled();
    h.client.readAcpPlanHistory.mockRejectedValueOnce(new Error("历史读取失败"));
    await screen.getByRole("button", { name: "刷新记录", exact: true }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("历史读取失败");
    let release!: (value: never) => void;
    h.client.readAcpPlanHistory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await screen.getByRole("button", { name: "刷新记录", exact: true }).click();
    await screen.getByRole("button", { name: "关闭", exact: true }).click();
    release({ projectId: "p", data: [run("late", "started", "late")] } as never);
    await screen.getByRole("button", { name: "运行记录", exact: true }).click();
    await expect.element(screen.getByText("无法确认", { exact: true })).toBeVisible();
    expect(screen.getByText("late", { exact: true }).elements()).toHaveLength(0);
    await screen.unmount();
  });
}

for (const [name, Container] of [
  ["Web", Web],
  ["Native", Native],
] as const) {
  it(`${name} 变更通知校准历史且最后卸载释放，不产生额外轮询`, async () => {
    const h = fixture();
    const listeners = new Set<() => void>();
    const stop = vi.fn();
    h.client.subscribeAcpPlans.mockImplementation((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    });
    const screen = await render(
      <QueryClientProvider client={h.cache}>
        <Container {...({ context: h.context, projectId: "p", temporary: false } as never)} />
      </QueryClientProvider>,
    );
    await screen.getByRole("button", { name: "运行记录", exact: true }).click();
    await expect.element(screen.getByText("待确认", { exact: true })).toBeVisible();
    h.client.readAcpPlanHistory.mockResolvedValue({
      projectId: "p",
      data: [run("a", "started", "task/id")],
    } as never);
    for (const listener of listeners) listener();
    await expect.poll(() => h.client.readAcpPlanHistory.mock.calls.length).toBe(2);
    await expect.element(screen.getByText("待确认", { exact: true })).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "关闭", exact: true }).click();
    expect(listeners.size).toBe(1);
    await screen.unmount();
    expect(listeners.size).toBe(0);
    expect(stop).toHaveBeenCalledTimes(2);
  });
}

for (const [name, Container] of [
  ["Web", Web],
  ["Native", Native],
] as const) {
  it(`${name} 关闭历史阻止迟到任务导航`, async () => {
    const h = fixture();
    let resolveTask!: (value: never) => void;
    if (name === "Web")
      h.client.readNavigableTask.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTask = resolve;
          }),
      );
    else
      h.client.readTask.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTask = resolve;
          }),
      );
    const screen = await render(
      <QueryClientProvider client={h.cache}>
        <Container {...({ context: h.context, projectId: "p", temporary: false } as never)} />
      </QueryClientProvider>,
    );
    await screen.getByRole("button", { name: "运行记录", exact: true }).click();
    await screen.getByRole("button", { name: "打开任务", exact: true }).click();
    await screen.getByRole("button", { name: "关闭", exact: true }).click();
    resolveTask(
      (name === "Web"
        ? { task: { id: "task/id", projectId: "p" } }
        : { id: "task/id", projectId: "p" }) as never,
    );
    await screen.getByRole("button", { name: "运行记录", exact: true }).click();
    await expect.element(screen.getByText("待确认", { exact: true })).toBeVisible();
    expect(h.navigate).not.toHaveBeenCalled();
    await screen.unmount();
  });
}
