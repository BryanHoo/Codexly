import { describe, expect, it } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import { mapClaudePlan } from "./observability.js";
import { ClaudeTurnProjection } from "./turn-projection.js";

function harness() {
  const events: AgentProviderEvent[] = [];
  const turn = new ClaudeTurnProjection("task", "turn", "prompt", (event) => events.push(event));
  const call = (id: string, name: string, input: unknown) => {
    turn.receive({
      type: "assistant",
      message: { id: `msg-${id}`, content: [{ type: "tool_use", id, name, input }] },
    });
  };
  const result = (id: string, isError = false, toolResult?: unknown) => {
    turn.receive({
      type: "user",
      tool_use_result: toolResult,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            is_error: isError,
            content: typeof toolResult === "string" ? toolResult : "result",
          },
        ],
      },
    });
  };
  const plans = () => events.filter((event) => event.type === "plan.updated");
  const todos = (content: string) => ({ todos: [{ content, status: "completed" }] });
  return { turn, events, call, result, plans, todos };
}

describe("TodoWrite plan commits", () => {
  it("waits for a matching successful tool result and ignores replayed calls and results", () => {
    const h = harness();
    h.call("todo", "TodoWrite", h.todos("检查组件"));
    expect(h.turn.plan).toBeNull();
    expect(h.plans()).toEqual([]);
    h.result("unrelated");
    expect(h.turn.plan).toBeNull();
    h.result("todo");
    expect(h.turn.plan?.steps).toEqual([{ text: "检查组件", status: "completed" }]);
    expect(h.plans()).toHaveLength(1);
    h.result("todo");
    h.result("todo", true, "重复的失败结果");
    h.call("todo", "TodoWrite", h.todos("不能重放"));
    h.result("todo");
    expect(h.plans()).toHaveLength(1);
    expect(h.turn.plan?.steps[0]?.text).toBe("检查组件");
    expect(h.turn.snapshot().items.find((item) => item.id === "todo")).toMatchObject({
      status: "completed",
    });
  });

  it("waits through streamed arguments, the complete assistant block and content_block_stop", () => {
    const h = harness();
    const stream = (event: unknown) => {
      h.turn.receive({ type: "stream_event", event });
    };
    stream({ type: "message_start", message: { id: "msg-todo" } });
    stream({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "todo", name: "TodoWrite", input: {} },
    });
    stream({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(h.todos("流式计划")) },
    });
    // 官方 SDK 在内容块 stop 之前发送完整 assistant 消息，两种信号都不能代替执行结果。
    h.call("todo", "TodoWrite", h.todos("流式计划"));
    stream({ type: "content_block_stop", index: 0 });
    expect(h.turn.plan).toBeNull();
    expect(h.plans()).toEqual([]);
    h.result("todo");
    expect(h.turn.plan?.steps).toEqual([{ text: "流式计划", status: "completed" }]);
    expect(h.plans()).toHaveLength(1);
  });

  it.each(["用户拒绝", "工具执行失败"])("preserves task identities after %s", (reason) => {
    const h = harness();
    h.call("create", "TaskCreate", { subject: "已有任务" });
    h.result("create", false, { task: { id: "42", subject: "已有任务" } });
    const before = h.turn.metadata();
    h.call("denied", "TodoWrite", h.todos("不应完成"));
    expect(h.turn.metadata()).toEqual(before);
    h.result("denied", true, reason);
    h.result("denied");
    h.call("denied", "TodoWrite", h.todos("重复失败调用"));
    h.result("denied");
    expect(h.turn.metadata()).toEqual(before);
    expect(h.plans()).toHaveLength(1);
    h.call("update", "TaskUpdate", { taskId: "42", status: "completed" });
    h.result("update", false, { success: true, taskId: "42" });
    expect(h.turn.plan?.steps).toEqual([{ text: "已有任务", status: "completed" }]);
  });

  it("clears task identities only after successful TodoWrite and supports switching back", () => {
    const h = harness();
    h.call("create", "TaskCreate", { subject: "旧任务" });
    h.result("create", false, { task: { id: "42" } });
    h.call("todo", "TodoWrite", h.todos("Todo 任务"));
    h.call("update", "TaskUpdate", { taskId: "42", status: "in_progress" });
    h.result("update", false, { success: true });
    expect(h.turn.metadata().planTasks).toHaveLength(1);
    h.result("todo");
    expect(h.turn.metadata().planTasks).toEqual([]);
    h.call("stale-update", "TaskUpdate", { taskId: "42", status: "completed" });
    h.result("stale-update", false, { success: true });
    expect(h.turn.plan?.steps[0]?.text).toBe("Todo 任务");
    h.call("new-create", "TaskCreate", { subject: "新任务" });
    h.result("new-create", false, { task: { id: "43" } });
    h.result("todo");
    expect(h.turn.plan?.steps).toEqual([{ text: "新任务", status: "pending" }]);
    expect(h.turn.metadata().planTasks?.[0]?.id).toBe("43");
  });

  it("correlates pending plans by tool_use_id rather than the latest generated arguments", () => {
    const h = harness();
    h.call("first", "TodoWrite", h.todos("第一个计划"));
    h.call("second", "TodoWrite", h.todos("第二个计划"));
    h.result("first");
    expect(h.turn.plan?.steps[0]?.text).toBe("第一个计划");
    h.result("second", true);
    expect(h.turn.plan?.steps[0]?.text).toBe("第一个计划");
    expect(h.plans()).toHaveLength(1);
  });

  it("does not commit calls without results when the turn ends", () => {
    const h = harness();
    h.call("todo", "TodoWrite", h.todos("未执行"));
    h.turn.finish("interrupted");
    h.result("todo");
    expect(h.turn.plan).toBeNull();
    expect(h.plans()).toEqual([]);
  });

  it("does not clear tasks for malformed input and accepts a successful empty plan", () => {
    const h = harness();
    h.call("create", "TaskCreate", { subject: "已有任务" });
    h.result("create", false, { task: { id: "42" } });
    h.call("invalid", "TodoWrite", { todos: "invalid" });
    h.result("invalid");
    expect(h.turn.metadata().planTasks).toHaveLength(1);
    h.call("empty", "TodoWrite", { todos: [] });
    expect(h.turn.metadata().planTasks).toHaveLength(1);
    h.result("empty");
    expect(h.turn.plan?.steps).toEqual([]);
    expect(h.turn.metadata().planTasks).toEqual([]);
  });
});

describe("TodoWrite plan budgets", () => {
  it.each(["任务😀", '\u0000\n"\\'])("bounds count and serialized title bytes for %j", (text) => {
    const todos = Array.from({ length: 1000 }, () => ({
      content: text.repeat(1000),
      status: "completed",
    }));
    const mapped = mapClaudePlan({ todos });
    expect(mapped?.steps).toHaveLength(128);
    for (const step of mapped?.steps ?? []) {
      expect(Buffer.byteLength(JSON.stringify(step.text))).toBeLessThanOrEqual(512);
      expect(step.text.isWellFormed()).toBe(true);
    }
    const h = harness();
    h.call("large", "TodoWrite", { todos });
    expect(h.plans()).toEqual([]);
    h.result("large");
    expect(h.turn.plan).toEqual(mapped);
    expect(h.turn.plan?.steps).toHaveLength(128);
    expect(Buffer.byteLength(JSON.stringify(h.turn.metadata()))).toBeLessThan(256 * 1024);
    for (const event of h.events)
      expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(512 * 1024);
  });
});
