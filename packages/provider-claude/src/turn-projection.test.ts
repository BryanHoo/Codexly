import { describe, expect, it } from "vitest";
import { ClaudeTurnProjection } from "./turn-projection.js";
import type { AgentProviderEvent } from "@codexly/core";
import type { ClaudeTaskMetadata } from "./history.js";
import type { SDKLocalCommandOutputMessage } from "@anthropic-ai/claude-agent-sdk";

it.each(["", "本地命令结果"])(
  "renders local command output without relying on result text %s",
  (result) => {
    const events: AgentProviderEvent[] = [];
    const turn = new ClaudeTurnProjection("task", "turn", "/usage", (event) => events.push(event));
    const output: SDKLocalCommandOutputMessage = {
      type: "system",
      subtype: "local_command_output",
      content: "本地命令结果",
      uuid: "00000000-0000-0000-0000-000000000001",
      session_id: "session",
    };
    turn.receive(output);
    expect(turn.snapshot().status).toBe("running");
    expect(events.filter((event) => event.type === "item.completed")).toHaveLength(1);
    turn.receive(output);
    turn.receive({ type: "result", subtype: "success", result });
    expect(
      turn.snapshot().items.filter((item) => item.type === "message" && item.role === "assistant"),
    ).toEqual([expect.objectContaining({ text: "本地命令结果" })]);
    expect(turn.status).toBe("completed");
  },
);

it("keeps distinct local outputs bounded and ignores unrelated system messages", () => {
  const turn = new ClaudeTurnProjection("task", "turn", "/usage", () => undefined);
  turn.receive({ type: "system", subtype: "status", uuid: "status", content: "不可显示" });
  for (const uuid of ["first", "second"])
    turn.receive({
      type: "system",
      subtype: "local_command_output",
      uuid,
      content: "结果".repeat(200000),
    });
  const replies = turn
    .snapshot()
    .items.filter((item) => item.type === "message" && item.role === "assistant");
  expect(replies).toHaveLength(2);
  expect(JSON.stringify(replies)).toContain("省略");
  expect(Buffer.byteLength(JSON.stringify(turn.snapshot()))).toBeLessThan(512 * 1024);
});

function taskTool(
  turn: ClaudeTurnProjection,
  id: string,
  name: string,
  input: unknown,
  result: unknown,
  failed = false,
) {
  turn.receive({
    type: "assistant",
    message: { id: `msg-${id}`, content: [{ type: "tool_use", id, name, input }] },
  });
  turn.receive({
    type: "user",
    tool_use_result: result,
    message: {
      content: [{ type: "tool_result", tool_use_id: id, is_error: failed, content: "ok" }],
    },
  });
}

it("correlates TaskCreate results and persists task identities across turns", () => {
  const events: AgentProviderEvent[] = [];
  const first = new ClaudeTurnProjection("task", "first", "prompt", (event) => events.push(event));
  taskTool(
    first,
    "create",
    "TaskCreate",
    { subject: "检查组件" },
    { task: { id: "42", subject: "检查组件" } },
  );
  expect(first.plan).toEqual({
    explanation: null,
    steps: [{ text: "检查组件", status: "pending" }],
  });
  expect(events.at(-2)).toMatchObject({ type: "plan.updated" });
  const next = new ClaudeTurnProjection("task", "next", "continue", () => undefined);
  next.restoreMetadata(JSON.parse(JSON.stringify(first.metadata())) as ClaudeTaskMetadata);
  taskTool(
    next,
    "update",
    "TaskUpdate",
    { task_id: "42", status: "in_progress", subject: "检查共享组件" },
    { success: true, taskId: "42" },
  );
  expect(next.plan?.steps).toEqual([{ text: "检查共享组件", status: "in_progress" }]);
  taskTool(
    next,
    "done",
    "TaskUpdate",
    { id: "42", status: "completed" },
    { success: true, taskId: "42" },
  );
  expect(next.plan?.steps[0]?.status).toBe("completed");
  taskTool(
    next,
    "delete",
    "TaskUpdate",
    { taskId: "42", status: "deleted" },
    { success: true, taskId: "42" },
  );
  expect(next.plan?.steps).toEqual([]);
});

it("ignores failed task operations and reconciles TaskList and TaskGet", () => {
  const turn = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  taskTool(turn, "failed", "TaskCreate", { subject: "失败" }, { task: { id: "bad" } }, true);
  taskTool(turn, "missing", "TaskCreate", { subject: "缺少 ID" }, {});
  expect(turn.plan).toBeNull();
  taskTool(
    turn,
    "list",
    "TaskList",
    {},
    { tasks: [{ id: "a", subject: "读取任务", status: "pending" }] },
  );
  taskTool(turn, "denied", "TaskUpdate", { taskId: "a", status: "completed" }, { success: false });
  expect(turn.plan?.steps).toEqual([{ text: "读取任务", status: "pending" }]);
  taskTool(
    turn,
    "get",
    "TaskGet",
    { taskId: "a" },
    { task: { id: "a", subject: "读取任务", status: "completed" } },
  );
  expect(turn.plan?.steps[0]?.status).toBe("completed");
  taskTool(turn, "empty", "TaskList", {}, { tasks: [] });
  expect(turn.plan?.steps).toEqual([]);
});

it("keeps task projections bounded and isolates subagent task lists", () => {
  const turn = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  taskTool(
    turn,
    "list",
    "TaskList",
    {},
    {
      tasks: Array.from({ length: 200 }, (_, i) => ({
        id: String(i),
        subject: "任务".repeat(1000),
        status: "pending",
      })),
    },
  );
  expect(turn.plan?.steps).toHaveLength(128);
  expect(Buffer.byteLength(JSON.stringify(turn.metadata()))).toBeLessThan(256 * 1024);
  const before = turn.plan;
  turn.receive({
    type: "assistant",
    message: {
      id: "spawn",
      content: [{ type: "tool_use", id: "child", name: "Agent", input: { prompt: "检查子任务" } }],
    },
  });
  turn.receive({
    type: "assistant",
    parent_tool_use_id: "child",
    message: {
      id: "child",
      content: [
        { type: "tool_use", id: "child-create", name: "TaskCreate", input: { subject: "子任务" } },
      ],
    },
  });
  turn.receive({
    type: "user",
    parent_tool_use_id: "child",
    tool_use_result: { task: { id: "1", subject: "子任务" } },
    message: { content: [{ type: "tool_result", tool_use_id: "child-create", content: "ok" }] },
  });
  expect(turn.plan).toBe(before);
});

describe("Claude streaming projection", () => {
  it("reconciles partial text with the final message and waits for result to complete", () => {
    const events: AgentProviderEvent[] = [];
    const turn = new ClaudeTurnProjection("task", "turn", "你好", (event) => events.push(event));
    turn.receive({
      type: "stream_event",
      event: { type: "message_start", message: { id: "msg" } },
    });
    turn.receive({
      type: "stream_event",
      event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    });
    turn.receive({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "回答" } },
    });
    turn.receive({
      type: "assistant",
      message: { id: "msg", content: [{ type: "text", text: "回答" }] },
    });
    expect(turn.snapshot().status).toBe("running");
    expect(
      turn.snapshot().items.filter((item) => item.type === "message" && item.role === "assistant"),
    ).toEqual([{ id: "msg:0", type: "message", role: "assistant", text: "回答" }]);
    turn.receive({ type: "result", subtype: "success", result: "回答", is_error: false });
    expect(turn.snapshot().status).toBe("completed");
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    turn.receive({ type: "result", subtype: "success", result: "回答" });
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });

  it("keeps tool call identity, tool failures and reasoning separate from assistant text", () => {
    const turn = new ClaudeTurnProjection("task", "turn", "读取文件", () => undefined);
    turn.receive({
      type: "assistant",
      message: {
        id: "msg",
        content: [
          { type: "thinking", thinking: "先检查路径" },
          { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/tmp/test" } },
        ],
      },
    });
    turn.receive({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: "找不到文件", is_error: true },
        ],
      },
    });
    expect(turn.snapshot().items).toContainEqual({
      id: "tool-1",
      type: "tool",
      name: "Read",
      input: { file_path: "/tmp/test" },
      output: "找不到文件",
      status: "failed",
    });
    expect(turn.snapshot().items).toContainEqual({
      id: "msg:0",
      type: "reasoning",
      content: "先检查路径",
      summary: "",
    });
    turn.receive({
      type: "result",
      subtype: "error_during_execution",
      errors: ["API unavailable"],
    });
    expect(turn.snapshot()).toMatchObject({ status: "failed", error: "API unavailable" });
  });

  it("treats stream exhaustion as failure and cancellation as interrupted, never as success", () => {
    const failed = new ClaudeTurnProjection("t", "a", "hello", () => undefined);
    failed.finish("failed", "Claude stream ended without a result");
    expect(failed.snapshot()).toMatchObject({
      status: "failed",
      error: "Claude stream ended without a result",
    });
    const interrupted = new ClaudeTurnProjection("t", "b", "hello", () => undefined);
    interrupted.finish("interrupted");
    interrupted.receive({ type: "result", subtype: "success", result: "late" });
    expect(interrupted.snapshot().status).toBe("interrupted");
  });
});

it("finishes pending tool visuals when the turn is interrupted", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  projection.receive({
    type: "assistant",
    message: {
      id: "message",
      content: [{ type: "tool_use", id: "tool", name: "Write", input: {} }],
    },
  });
  projection.finish("interrupted");
  expect(projection.snapshot().items.find((item) => item.id === "tool")).toMatchObject({
    status: "failed",
  });
});

it("publishes complete streamed tool arguments before the tool result", () => {
  const events: AgentProviderEvent[] = [];
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", (event) =>
    events.push(event),
  );
  const stream = (event: unknown) => {
    projection.receive({ type: "stream_event", event });
  };
  stream({ type: "message_start", message: { id: "msg" } });
  stream({
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "read", name: "Read", input: {} },
  });
  stream({
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"file_path":' },
  });
  stream({
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '"/project/README.md"}' },
  });
  stream({ type: "content_block_stop", index: 0 });
  expect(events.at(-1)).toMatchObject({
    itemId: "read",
    payload: { item: { input: { file_path: "/project/README.md" }, status: "running" } },
  });
});

it("keeps separate content blocks when the SDK emits one assistant message per block", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  for (const [index, content] of ["first", "second"].entries()) {
    projection.receive({
      type: "stream_event",
      event: { type: "message_start", message: { id: "msg" } },
    });
    projection.receive({
      type: "stream_event",
      event: { type: "content_block_start", index, content_block: { type: "text", text: "" } },
    });
    projection.receive({
      type: "assistant",
      message: { id: "msg", content: [{ type: "text", text: content }] },
    });
  }
  expect(
    projection
      .snapshot()
      .items.filter((item) => item.type === "message" && item.role === "assistant")
      .map((item) => (item.type === "message" ? item.text : "")),
  ).toEqual(["first", "second"]);
});

it("tracks Claude agents and isolates their transcript from the parent reply", () => {
  const events: AgentProviderEvent[] = [];
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", (event) =>
    events.push(event),
  );
  projection.receive({
    type: "assistant",
    message: {
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "spawn",
          name: "Agent",
          input: { description: "检查组件", prompt: "检查共享组件", subagent_type: "Explore" },
        },
      ],
    },
  });
  projection.receive({
    type: "system",
    subtype: "task_started",
    task_id: "agent-1",
    tool_use_id: "spawn",
    task_type: "local_agent",
    description: "检查组件",
  });
  projection.receive({
    type: "assistant",
    parent_tool_use_id: "spawn",
    agent_id: "agent-1",
    message: { id: "child-msg", content: [{ type: "text", text: "组件检查结果" }] },
  });
  projection.receive({
    type: "system",
    subtype: "task_progress",
    task_id: "agent-1",
    summary: "正在检查组件",
    usage: { total_tokens: 20, tool_uses: 1, duration_ms: 10 },
  });
  expect(projection.snapshot().items.find((item) => item.id === "spawn")).toMatchObject({
    name: "agent/spawn",
    status: "running",
    output: {
      parentTaskId: "task",
      agents: [{ taskId: "spawn", nickname: "检查组件", status: "running" }],
      turn: {
        items: expect.arrayContaining([
          expect.objectContaining({ text: "组件检查结果" }),
        ]) as unknown,
      },
    },
  });
  projection.receive({
    type: "system",
    subtype: "task_notification",
    task_id: "agent-1",
    status: "completed",
    summary: "已检查",
  });
  expect(projection.snapshot().items.find((item) => item.id === "spawn")).toMatchObject({
    status: "completed",
    output: { agents: [{ status: "completed", message: "已检查" }] },
  });
  expect(
    projection
      .snapshot()
      .items.filter((item) => item.type === "message" && item.role === "assistant"),
  ).toHaveLength(0);
});

it("uses the latest main-model request for context rather than cumulative billing or subagent usage", () => {
  const events: AgentProviderEvent[] = [];
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", (event) =>
    events.push(event),
  );
  projection.receive({
    type: "assistant",
    message: {
      id: "msg",
      model: "main",
      content: [],
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 20,
        output_tokens: 5,
      },
    },
  });
  projection.receive({
    type: "assistant",
    parent_tool_use_id: "spawn",
    message: { id: "child", model: "child", content: [], usage: { input_tokens: 99999 } },
  });
  projection.receive({
    type: "result",
    subtype: "success",
    modelUsage: {
      main: { inputTokens: 999999, contextWindow: 200000 },
      child: { contextWindow: 1000000 },
    },
  });
  expect(events.filter((event) => event.type === "usage.updated").at(-1)).toMatchObject({
    payload: { usage: { contextWindow: 200000, usedTokens: 135 } },
  });
});

it("bounds streamed tool JSON before parsing it", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  projection.receive({
    type: "stream_event",
    event: { type: "message_start", message: { id: "msg" } },
  });
  projection.receive({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "read", name: "Read", input: {} },
    },
  });
  expect(() => {
    projection.receive({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "x".repeat(256 * 1024 + 1) },
      },
    });
  }).not.toThrow();
  projection.receive({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  expect(JSON.stringify(projection.snapshot())).toContain("省略");
});

it("does not mark a background agent completed when its dispatch returns", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  projection.receive({
    type: "assistant",
    message: {
      id: "msg",
      content: [
        {
          type: "tool_use",
          id: "spawn",
          name: "Task",
          input: { prompt: "检查组件", run_in_background: true },
        },
      ],
    },
  });
  projection.receive({
    type: "user",
    tool_use_result: { isAsync: true },
    message: {
      content: [{ type: "tool_result", tool_use_id: "spawn", content: "background started" }],
    },
  });
  expect(projection.snapshot().items.find((item) => item.id === "spawn")).toMatchObject({
    name: "agent/spawn",
    status: "running",
  });
  projection.finish("interrupted");
  expect(projection.snapshot().items.find((item) => item.id === "spawn")).toMatchObject({
    status: "interrupted",
    output: { agents: [{ status: "interrupted" }] },
  });
});

it("routes nested agents and retains a text-block result when no assistant transcript was emitted", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  const spawn = (id: string) => ({ type: "tool_use", id, name: "Agent", input: { prompt: id } });
  projection.receive({ type: "assistant", message: { id: "root", content: [spawn("outer")] } });
  projection.receive({
    type: "assistant",
    parent_tool_use_id: "outer",
    agent_id: "a",
    message: { id: "child", content: [spawn("inner")] },
  });
  projection.receive({
    type: "assistant",
    parent_tool_use_id: "inner",
    agent_id: "b",
    message: { id: "grandchild", content: [{ type: "text", text: "nested proof" }] },
  });
  const outer = projection.snapshot().items.find((item) => item.id === "outer");
  expect(JSON.stringify(outer)).toContain("nested proof");
  projection.receive({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "outer",
          content: [{ type: "text", text: "final agent proof" }],
        },
      ],
    },
  });
  expect(JSON.stringify(projection.snapshot().items.find((item) => item.id === "outer"))).toContain(
    "final agent proof",
  );
});

it("keeps background agents alive after the parent result and accepts their late completion", () => {
  const events: AgentProviderEvent[] = [];
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", (event) =>
    events.push(event),
  );
  projection.receive({
    type: "assistant",
    message: {
      id: "root",
      content: [
        {
          type: "tool_use",
          id: "spawn",
          name: "Agent",
          input: { run_in_background: true, prompt: "inspect" },
        },
      ],
    },
  });
  projection.receive({
    type: "system",
    subtype: "task_started",
    task_id: "child",
    tool_use_id: "spawn",
  });
  projection.receive({ type: "result", subtype: "success", result: "parent done" });
  expect(projection.status).toBe("completed");
  expect(projection.snapshot().items.find((item) => item.id === "spawn")).toMatchObject({
    status: "running",
  });
  projection.receive({
    type: "assistant",
    parent_tool_use_id: "spawn",
    message: { id: "late", content: [{ type: "text", text: "late proof" }] },
  });
  projection.receive({
    type: "system",
    subtype: "task_notification",
    task_id: "child",
    status: "completed",
    summary: "child done",
  });
  expect(projection.snapshot().items.find((item) => item.id === "spawn")).toMatchObject({
    status: "completed",
    output: { turn: { status: "completed" } },
  });
  expect(JSON.stringify(projection.snapshot())).toContain("late proof");
  expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
});
