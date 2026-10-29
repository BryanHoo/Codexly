import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { AgentTurn } from "@codexly/protocol";
import { Subagent } from "@codexly/ui/agent/subagent";
import { AgentLocaleProvider } from "@codexly/ui/agent/locale";
import { OperationDetailsProvider } from "@codexly/ui/agent/tool-details";
import { Tool, ToolHeader, ToolContent, ToolOutput } from "@codexly/ui/agent/tool";
import { SubagentToolItem } from "../../../features/workbench/components/task-timeline-status.js";
import { TimelineItemContent } from "../../../features/workbench/components/task-timeline-items.js";
import "../../styles/globals.css";

afterEach(async () => {
  await page.viewport(1440, 900);
});

for (const width of [390, 1280]) {
  test(`子代理弹窗限制高度、默认跟随输出，上滚暂停后回底恢复 ${width}px`, async () => {
    await page.viewport(width, 800);
    function Harness({ revision = 0 }: { revision?: number }) {
      return (
        <OperationDetailsProvider closeLabel="关闭">
          <Subagent
            title="跟随输出"
            state="input-available"
            agents={[]}
            loadOlderLabel="加载更早记录"
            item={{
              id: "spawn",
              type: "tool",
              name: "agent/spawn",
              status: "running",
              output: {
                parentTaskId: "parent",
                turn: {
                  id: "child",
                  status: "running",
                  items: [
                    { id: "log", type: "message", role: "assistant", text: String(revision) },
                  ],
                },
              },
            }}
            renderItem={() => <div style={{ height: 2000 + revision * 300 }}>输出 {revision}</div>}
          />
        </OperationDetailsProvider>
      );
    }
    const screen = await render(<Harness />);
    await screen.getByRole("button", { name: /跟随输出/ }).click();
    const dialog = screen.getByRole("dialog").element();
    const viewport = dialog.querySelector<HTMLElement>("[data-operation-detail-body]")!;
    const gap = () => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    await expect.poll(() => dialog.getBoundingClientRect().height).toBeLessThanOrEqual(641);
    await expect.poll(gap).toBeLessThanOrEqual(1);
    await screen.rerender(<Harness revision={1} />);
    await expect.poll(gap).toBeLessThanOrEqual(1);
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -300 }));
    viewport.scrollTop -= 300;
    viewport.dispatchEvent(new Event("scroll"));
    const readingTop = viewport.scrollTop;
    await screen.rerender(<Harness revision={2} />);
    await expect.poll(() => viewport.scrollHeight).toBeGreaterThan(2500);
    expect(viewport.scrollTop).toBeCloseTo(readingTop, 0);
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event("scroll"));
    await screen.rerender(<Harness revision={3} />);
    await expect.poll(gap).toBeLessThanOrEqual(1);
    await userEvent.keyboard("{Escape}");
  });
}

for (const width of [390, 1280]) {
  test(`子代理详情按需挂载、分页和流式刷新，关闭恢复焦点 ${width}px`, async () => {
    await page.viewport(width, 800);
    const turn: AgentTurn = {
      id: "child",
      status: "running",
      startedAt: "2026-10-29T00:00:00Z",
      completedAt: null,
      error: null,
      items: Array.from({ length: 60 }, (_, index) => ({
        id: `read-${index}`,
        type: "tool",
        name: `读取文件 ${index}`,
        status: "completed",
      })),
    };
    function Harness({ done = false }: { done?: boolean }) {
      return (
        <AgentLocaleProvider translate={(key) => key}>
          <OperationDetailsProvider closeLabel="关闭">
            <div style={{ width: "100%", maxWidth: 600, height: 140, overflow: "hidden" }}>
              <Subagent
                title="检查缓存"
                state={done ? "output-available" : "input-available"}
                item={{
                  id: "spawn",
                  type: "tool",
                  name: "agent/spawn",
                  status: done ? "completed" : "running",
                  input: { prompt: "分析缓存键" },
                  output: {
                    parentTaskId: "parent",
                    turn: { ...turn, status: done ? "completed" : "running" },
                  },
                }}
                agents={[
                  {
                    taskId: "research",
                    nickname: "缓存研究员",
                    status: done ? "completed" : "running",
                    ...(done ? { message: "已找到问题" } : {}),
                  },
                ]}
                model={"model-" + "x".repeat(300)}
                prompt="分析缓存键"
                loadOlderLabel="加载更早记录"
                renderItem={(item) =>
                  item.type === "tool" ? (
                    <Tool>
                      <ToolHeader title={item.name} state="output-available" />
                      <ToolContent>
                        <ToolOutput errorText={undefined} output="执行结果" />
                      </ToolContent>
                    </Tool>
                  ) : null
                }
              />
            </div>
          </OperationDetailsProvider>
        </AgentLocaleProvider>
      );
    }
    const screen = await render(<Harness />);
    expect(document.querySelector("[data-subagent-details]")).toBeNull();
    const trigger = screen.getByRole("button", { name: /检查缓存/ });
    await trigger.click();
    const dialog = screen.getByRole("dialog");
    await expect.element(dialog.getByText("分析缓存键")).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: /读取文件 10$/ })).toBeVisible();
    expect(dialog.element().querySelectorAll("[data-subagent-steps] > div")).toHaveLength(50);
    await dialog.getByRole("button", { name: "加载更早记录" }).click();
    expect(dialog.element().querySelectorAll("[data-subagent-steps] > div")).toHaveLength(60);
    expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth + 1);
    // 外部事件更新保持已打开的详情；模拟父条目的流式快照到达。
    await screen.rerender(<Harness done />);
    await expect.element(dialog.getByText("已找到问题")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveFocus();
    await expect.poll(() => document.querySelector("[data-subagent-details]")).toBeNull();
    await trigger.click();
    await expect.element(dialog.getByText("已找到问题")).toBeVisible();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect.element(trigger).toHaveFocus();
  });
}

test("桌面嵌套思考只投影公开摘要，不展示原始推理正文", async () => {
  const screen = await render(
    <OperationDetailsProvider closeLabel="关闭">
      <SubagentToolItem
        item={{
          id: "spawn",
          type: "tool",
          name: "agent/spawn",
          status: "running",
          output: {
            parentTaskId: "parent",
            turn: {
              id: "child",
              status: "running",
              startedAt: "2026-10-29T00:00:00Z",
              completedAt: null,
              error: null,
              items: [
                {
                  id: "reasoning",
                  type: "reasoning",
                  summary: "公开思考摘要",
                  content: "不得展示的原始推理",
                },
              ],
            },
          },
        }}
        operation={{ name: "agent/spawn", agents: [] }}
        renderItem={TimelineItemContent}
        context={{
          projectId: "project",
          taskId: "parent",
          onOpenFileDiff: () => undefined,
          onOpenSourceFile: () => undefined,
        }}
      />
    </OperationDetailsProvider>,
  );
  await screen.getByRole("button").click();
  await expect
    .element(screen.getByRole("dialog").getByRole("button", { name: /公开思考摘要/ }))
    .toBeVisible();
  expect(screen.getByRole("dialog").element().textContent).not.toContain("不得展示的原始推理");
});
