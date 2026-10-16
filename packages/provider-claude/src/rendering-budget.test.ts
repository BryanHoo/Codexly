import { expect, it, vi } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import { ClaudeTurnProjection } from "./turn-projection.js";

const tool = (id: string, name = "Read") => ({
  type: "tool_use",
  id,
  name,
  input: { file_path: `/project/${id}` },
});

it.each(["completed", "interrupted", "failed"] as const)(
  "keeps a long child transcript bounded and finishes %s without throwing again",
  (status) => {
    const events: AgentProviderEvent[] = [];
    const projection = new ClaudeTurnProjection("task", "turn", "prompt", (event) =>
      events.push(event),
    );
    projection.receive({
      type: "assistant",
      message: { id: "root", content: [tool("spawn", "Agent")] },
    });
    expect(() => {
      for (let index = 0; index < 48; index++) {
        projection.receive({
          type: "assistant",
          parent_tool_use_id: "spawn",
          message: { id: `child-${String(index)}`, content: [tool(`read-${String(index)}`)] },
        });
        projection.receive({
          type: "user",
          parent_tool_use_id: "spawn",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: `read-${String(index)}`,
                content: "组件读取结果🦀".repeat(1024),
              },
            ],
          },
        });
      }
      projection.finish(status);
    }).not.toThrow();
    expect(projection.status).toBe(status);
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(projection.snapshot()))).toBeLessThan(384 * 1024);
    expect(JSON.stringify(projection.snapshot())).toContain("read-47");
    expect(JSON.stringify(projection.snapshot())).toContain("省略");
    for (const event of events)
      expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(512 * 1024);
  },
);

it("renders oversized tool results as previews and still accepts the SDK success result", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  projection.receive({ type: "assistant", message: { id: "root", content: [tool("read")] } });
  expect(() => {
    projection.receive({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "read", content: `BEGIN${"🦀".repeat(200000)}END` },
        ],
      },
    });
    projection.receive({ type: "result", subtype: "success", result: "任务完成" });
  }).not.toThrow();
  expect(projection.snapshot().status).toBe("completed");
  const output = projection.snapshot().items.find((item) => item.id === "read");
  expect(JSON.stringify(output)).toContain("BEGIN");
  expect(JSON.stringify(output)).toContain("END");
  expect(JSON.stringify(output)).not.toContain("�");
});

it("bounds a long main turn below the realtime frame limit and retains the latest result", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  expect(() => {
    for (let index = 0; index < 120; index++) {
      projection.receive({
        type: "assistant",
        message: {
          id: `msg-${String(index)}`,
          content: [{ type: "text", text: `step-${String(index)} ${"x".repeat(12000)}` }],
        },
      });
    }
    projection.receive({ type: "result", subtype: "success", result: "done" });
  }).not.toThrow();
  expect(projection.status).toBe("completed");
  expect(Buffer.byteLength(JSON.stringify(projection.snapshot()))).toBeLessThan(384 * 1024);
  expect(JSON.stringify(projection.snapshot())).toContain("step-119");
});

it("bounds streaming text without forwarding unbounded deltas and reconciles the final tail", () => {
  const events: AgentProviderEvent[] = [];
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", (event) =>
    events.push(event),
  );
  const stream = (event: unknown) => {
    projection.receive({ type: "stream_event", event });
  };
  stream({ type: "message_start", message: { id: "msg" } });
  stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  const chunk = "x".repeat(8000);
  expect(() => {
    for (let index = 0; index < 200; index++)
      stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: chunk } });
    projection.receive({
      type: "assistant",
      message: { id: "msg", content: [{ type: "text", text: `START${chunk.repeat(200)}FINAL` }] },
    });
    projection.receive({ type: "result", subtype: "success" });
  }).not.toThrow();
  expect(projection.status).toBe("completed");
  expect(JSON.stringify(projection.snapshot())).toContain("FINAL");
  const transferred = events.reduce(
    (bytes, event) => bytes + Buffer.byteLength(JSON.stringify(event)),
    0,
  );
  expect(transferred).toBeLessThan(512 * 1024);
});

it("retains the user prompt and valid item structures after streaming and eviction", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "原始用户请求", () => undefined);
  projection.receive({
    type: "stream_event",
    event: { type: "message_start", message: { id: "msg" } },
  });
  projection.receive({
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  });
  projection.receive({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "partial" },
    },
  });
  expect(projection.snapshot().items).toContainEqual({
    id: "turn",
    type: "message",
    role: "user",
    text: "原始用户请求",
  });
  expect(projection.snapshot().items).toContainEqual({
    id: "msg:0",
    type: "message",
    role: "assistant",
    text: "partial",
  });
});

it("keeps agent identities and terminal states when concurrent transcripts exceed the parent budget", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  for (let index = 0; index < 16; index++) {
    const id = `agent-${String(index)}`;
    projection.receive({ type: "assistant", message: { id, content: [tool(id, "Agent")] } });
    projection.receive({
      type: "assistant",
      parent_tool_use_id: id,
      message: {
        id: `child-${id}`,
        content: [{ type: "text", text: "large transcript ".repeat(4000) }],
      },
    });
  }
  for (let index = 0; index < 16; index++)
    projection.receive({
      type: "system",
      subtype: "task_notification",
      tool_use_id: `agent-${String(index)}`,
      task_id: `native-${String(index)}`,
      status: "completed",
      summary: "done",
    });
  projection.receive({ type: "result", subtype: "success" });
  const agents = projection
    .snapshot()
    .items.filter((item) => item.type === "tool" && item.name === "agent/spawn");
  expect(agents).toHaveLength(16);
  for (const agent of agents) expect(agent).toMatchObject({ status: "completed" });
  expect(Buffer.byteLength(JSON.stringify(projection.snapshot()))).toBeLessThan(384 * 1024);
});

it("counts only appended chunks on the normal streaming path", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  projection.receive({
    type: "stream_event",
    event: { type: "message_start", message: { id: "msg" } },
  });
  projection.receive({
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  });
  const original = JSON.stringify;
  let scanned = 0;
  const spy = vi.spyOn(JSON, "stringify").mockImplementation((value: unknown) => {
    if (value && typeof value === "object" && "text" in value && typeof value.text === "string")
      scanned += value.text.length;
    return original(value);
  });
  try {
    for (let index = 0; index < 256; index++)
      projection.receive({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "x".repeat(128) },
        },
      });
  } finally {
    spy.mockRestore();
  }
  expect(scanned).toBeLessThan(65536);
});

it("recycles completed child previews beyond 64 sequential calls without changing real results", () => {
  const events: AgentProviderEvent[] = [];
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", (event) =>
    events.push(event),
  );
  for (let index = 0; index < 160; index++) {
    const id = `sequential-${String(index)}`;
    projection.receive({ type: "assistant", message: { id, content: [tool(id, "Agent")] } });
    projection.receive({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content: `真实结果 ${String(index)}`,
            is_error: index === 159,
          },
        ],
      },
    });
    expect(projection.snapshot().items.find((item) => item.id === id)).toMatchObject({
      status: index === 159 ? "failed" : "completed",
      output: {
        agents: [{ message: `真实结果 ${String(index)}` }],
        turn: { status: index === 159 ? "failed" : "completed" },
      },
    });
  }
  projection.receive({ type: "result", subtype: "success", result: "父回合成功" });
  expect(projection.status).toBe("completed");
  expect(projection.hasBackgroundWork).toBe(false);
  expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  expect(Buffer.byteLength(JSON.stringify(projection.snapshot()))).toBeLessThan(384 * 1024);
});

it("keeps more than 64 active background agents until their actual terminal notifications", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  for (let index = 0; index < 80; index++) {
    const id = `parallel-${String(index)}`;
    projection.receive({
      type: "assistant",
      message: { id, content: [{ ...tool(id, "Agent"), input: { run_in_background: true } }] },
    });
    projection.receive({
      type: "system",
      subtype: "task_started",
      tool_use_id: id,
      task_id: `native-${id}`,
    });
  }
  projection.receive({ type: "result", subtype: "success" });
  expect(projection.hasBackgroundWork).toBe(true);
  for (let index = 0; index < 80; index++) {
    const id = `parallel-${String(index)}`;
    expect(projection.ownsMessage({ task_id: `native-${id}` })).toBe(true);
    projection.receive({
      type: "system",
      subtype: "task_notification",
      task_id: `native-${id}`,
      status: index === 79 ? "stopped" : "completed",
      summary: `完成 ${String(index)}`,
    });
  }
  expect(projection.hasBackgroundWork).toBe(false);
  expect(projection.status).toBe("completed");
  expect(projection.snapshot().items.find((item) => item.id === "parallel-79")).toMatchObject({
    status: "interrupted",
    output: { agents: [{ status: "interrupted", message: "完成 79" }] },
  });
});

it("retains a completed child with active descendants and ignores late output after retirement", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  projection.receive({
    type: "assistant",
    message: { id: "root", content: [tool("outer", "Agent")] },
  });
  projection.receive({
    type: "assistant",
    parent_tool_use_id: "outer",
    message: {
      id: "nested",
      content: [{ ...tool("inner", "Agent"), input: { run_in_background: true } }],
    },
  });
  projection.receive({
    type: "system",
    subtype: "task_started",
    tool_use_id: "inner",
    task_id: "native-inner",
  });
  projection.receive({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "outer", content: "外层已返回" }] },
  });
  projection.receive({ type: "result", subtype: "success" });
  expect(projection.hasBackgroundWork).toBe(true);
  expect(projection.ownsMessage({ task_id: "native-inner" })).toBe(true);
  projection.receive({
    type: "system",
    subtype: "task_notification",
    task_id: "native-inner",
    status: "completed",
    summary: "后代完成",
  });
  expect(projection.hasBackgroundWork).toBe(false);
  const snapshot = projection.snapshot();
  expect(JSON.stringify(snapshot)).toContain("后代完成");
  projection.receive({
    type: "assistant",
    parent_tool_use_id: "outer",
    message: { id: "late", content: [{ type: "text", text: "迟到正文不能污染父回合" }] },
  });
  expect(projection.snapshot()).toEqual(snapshot);
});
