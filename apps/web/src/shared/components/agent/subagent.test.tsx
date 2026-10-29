import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { Subagent } from "@codexly/ui/agent/subagent";

const turn: AgentTurn = {
  id: "child-turn",
  status: "running",
  startedAt: "2026-10-29T00:00:00Z",
  completedAt: null,
  error: null,
  items: Array.from({ length: 60 }, (_, index) => ({
    id: `step-${String(index)}`,
    type: "tool",
    name: `read-${String(index)}`,
    status: "completed",
  })),
};
const item: Extract<AgentItem, { type: "tool" }> = {
  id: "spawn",
  type: "tool",
  name: "agent/spawn",
  status: "running",
  input: { prompt: "检查缓存", model: "test-model" },
  output: { parentTaskId: "parent", turn },
};
const props = {
  item,
  title: "研究代理",
  state: "input-available" as const,
  prompt: "检查缓存",
  model: "test-model",
  reasoningEffort: "high",
  agents: [{ taskId: "child", nickname: "研究员", status: "running" as const }],
  loadOlderLabel: "加载更早记录",
};

describe("Subagent", () => {
  it.each([false, true])("只去除初始提示词副本，保留后续消息（含省略标记：%s）", (omitted) => {
    const nestedTurn: AgentTurn = {
      ...turn,
      items: [
        ...(omitted
          ? [
              {
                id: `${turn.id}:rendering-omitted`,
                type: "activity" as const,
                label: "已省略较早执行记录",
              },
            ]
          : []),
        { id: "initial", type: "message", role: "user", text: "检查缓存" },
        { id: "tool", type: "tool", name: "read", status: "completed" },
        { id: "followup", type: "message", role: "user", text: "检查缓存" },
        { id: "different", type: "message", role: "user", text: "补充任务" },
      ],
    };
    const renderItem = vi.fn((nested: AgentItem) => createElement("p", null, nested.id));
    const html = renderToStaticMarkup(
      createElement(Subagent, {
        ...props,
        defaultOpen: true,
        renderItem,
        item: { ...item, output: { parentTaskId: "parent", turn: nestedTurn } },
      }),
    );
    expect(renderItem.mock.calls.map(([nested]) => nested.id)).toEqual([
      ...(omitted ? [`${turn.id}:rendering-omitted`] : []),
      "tool",
      "followup",
      "different",
    ]);
    expect(html).toContain("检查缓存");
  });

  it("关闭时不渲染嵌套执行记录和输入", () => {
    const renderItem = vi.fn(() => null);
    const html = renderToStaticMarkup(createElement(Subagent, { ...props, renderItem }));
    expect(html).toContain('data-subagent=""');
    expect(html).not.toContain("检查缓存");
    expect(renderItem).not.toHaveBeenCalled();
  });

  it("展开后展示任务、模型、代理状态及最近50条真实记录", () => {
    const renderItem = vi.fn((nested: AgentItem) => createElement("p", null, nested.id));
    const html = renderToStaticMarkup(
      createElement(Subagent, { ...props, defaultOpen: true, renderItem }),
    );
    expect(html).toContain("检查缓存");
    expect(html).toContain("test-model");
    expect(html).toContain("high");
    expect(html).toContain("研究员");
    expect(html).toContain('data-status="running"');
    expect(html).toContain("加载更早记录");
    expect(renderItem).toHaveBeenCalledTimes(50);
    expect(renderItem.mock.calls[0]?.[0].id).toBe("step-10");
    expect(html).not.toContain("parentTaskId");
  });

  it("普通代理结果显示失败状态、结果正文，并保留未知输出回退", () => {
    const html = renderToStaticMarkup(
      createElement(Subagent, {
        ...props,
        item: { ...item, output: "transport failed" },
        state: "output-error",
        defaultOpen: true,
        agents: [{ taskId: "child", nickname: "研究员", status: "failed", message: "测试失败" }],
      }),
    );
    expect(html).toContain("测试失败");
    expect(html).toContain('data-status="error"');
    expect(html).toContain("transport failed");
  });
});
