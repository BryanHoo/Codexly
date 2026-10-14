import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SidebarTaskShortcuts } from "@codexly/ui/core/sidebar-task-shortcuts";

const labels = {
  pinned: "已固定",
  active: "运行中",
  approval: (count: number) => `待确认 ${String(count)}`,
  showAll: (count: number) => `查看全部 ${String(count)} 项`,
  close: "关闭",
};
const tasks = Array.from({ length: 5 }, (_, index) => ({
  id: String(index),
  title: `固定任务${String(index)}`,
}));

describe("SidebarTaskShortcuts", () => {
  it("shows two pinned and two active previews with separate live counts", () => {
    const renderPinned = vi.fn((task: (typeof tasks)[number]) => <a href="/task">{task.title}</a>);
    const renderActive = vi.fn((task: { id: string; title: string }) => (
      <a href="/task">{task.title}</a>
    ));
    const activeTasks = tasks.map((task, index) => ({
      ...task,
      projectId: "p",
      title: `运行任务${String(index)}`,
      status: index === 0 ? ("approval" as const) : ("running" as const),
    }));
    const markup = renderToStaticMarkup(
      <SidebarTaskShortcuts
        pinnedTasks={tasks}
        activeTasks={activeTasks}
        runningCount={4}
        approvalCount={1}
        labels={labels}
        renderPinned={renderPinned}
        renderActive={renderActive}
      />,
    );
    expect(renderPinned).toHaveBeenCalledTimes(2);
    expect(renderActive).toHaveBeenCalledTimes(2);
    expect(markup).toContain("待确认 1");
    expect(markup).toContain("查看全部 5 项");
    expect(markup).not.toContain("固定任务2");
    expect(markup).not.toContain("运行任务2");
    expect(markup.indexOf("已固定")).toBeLessThan(markup.indexOf("运行中"));
  });

  it("omits empty groups and hides previews without losing counters when manually collapsed", () => {
    const storage = {
      getItem: () => JSON.stringify({ version: 1, pinned: false, active: false }),
      setItem: vi.fn(),
    };
    const renderPinned = vi.fn(() => <a href="/task">task</a>);
    const markup = renderToStaticMarkup(
      <SidebarTaskShortcuts
        pinnedTasks={tasks}
        activeTasks={[]}
        runningCount={0}
        approvalCount={0}
        labels={labels}
        storage={storage}
        renderPinned={renderPinned}
        renderActive={() => null}
      />,
    );
    expect(renderPinned).not.toHaveBeenCalled();
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("查看全部 5 项");
    expect(markup).not.toContain("运行中");
  });
});
