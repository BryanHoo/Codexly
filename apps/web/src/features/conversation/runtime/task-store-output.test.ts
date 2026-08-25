import type { AgentEvent } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { createTaskStore, createTaskItemKey, MAX_TASK_COMMAND_OUTPUT_BYTES } from "./task-store.js";
import {
  timestamp,
  runningItemKey,
  createResponse,
  eventEnvelope,
} from "./task-store.test-support.js";

describe("task store output retention", () => {
  it("stores item identifiers reused by another turn independently", () => {
    const duplicateItemResponse = createResponse({
      turns: [
        {
          completedAt: timestamp,
          error: null,
          id: "turn-first",
          items: [{ id: "shared-item", role: "assistant", text: "一", type: "message" }],
          startedAt: timestamp,
          status: "completed",
        },
        {
          completedAt: timestamp,
          error: null,
          id: "turn-second",
          items: [{ id: "shared-item", role: "assistant", text: "二", type: "message" }],
          startedAt: timestamp,
          status: "completed",
        },
      ],
    });

    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      duplicateItemResponse,
    );

    expect(
      store
        .getState()
        .reconstructSnapshot()
        ?.turns.map((turn) => ({
          id: turn.id,
          items: turn.items.map((item) => ({
            id: item.id,
            text: item.type === "message" ? item.text : "",
          })),
        })),
    ).toEqual([
      { id: "turn-first", items: [{ id: "shared-item", text: "一" }] },
      { id: "turn-second", items: [{ id: "shared-item", text: "二" }] },
    ]);
  });

  it("creates delta items and keeps command output UTF-8 safe within both bounds", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const oversizedOutput = `${"一".repeat(400_000)}\n${"line\n".repeat(10_001)}`;

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "reasoning-new",
        payload: { delta: "摘要", field: "summary" },
        turnId: "turn-running",
        type: "reasoning.delta",
      },
      {
        ...eventEnvelope(12),
        itemId: "command-new",
        payload: { delta: oversizedOutput },
        turnId: "turn-running",
        type: "command.output_delta",
      },
    ]);

    const state = store.getState();
    const commandItem = state.getItem("command-new", "turn-running");
    expect(state.getItem("reasoning-new", "turn-running")).toMatchObject({ summary: "摘要" });
    expect(commandItem).toMatchObject({ outputTruncated: true, type: "command" });
    if (commandItem?.type !== "command") {
      throw new Error("Expected normalized command item");
    }
    expect(new TextEncoder().encode(commandItem.output ?? "").byteLength).toBeLessThanOrEqual(
      1_048_576,
    );
    expect(commandItem.output).not.toContain("�");
    expect((commandItem.output?.match(/\n/g) ?? []).length).toBeLessThanOrEqual(9_999);
  });

  it("evicts least-recently-used command output when a task exceeds its byte budget", () => {
    const commandOutput = "x".repeat(1_000_000);
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({
        turns: [
          {
            completedAt: timestamp,
            error: null,
            id: "turn-command-history",
            items: Array.from({ length: 9 }, (_, commandIndex) => ({
              command: `command-${String(commandIndex)}`,
              cwd: "/workspace",
              id: `command-${String(commandIndex)}`,
              output: commandOutput,
              outputTruncated: false,
              status: "completed" as const,
              type: "command" as const,
            })),
            startedAt: timestamp,
            status: "completed",
          },
        ],
      }),
    );

    const state = store.getState();
    expect(state.commandOutputBytes).toBeLessThanOrEqual(MAX_TASK_COMMAND_OUTPUT_BYTES);
    expect(state.getItem("command-0", "turn-command-history")).toMatchObject({
      outputTruncated: true,
    });
    expect(state.getItem("command-8", "turn-command-history")).toMatchObject({
      output: commandOutput,
    });
    expect(
      state.itemStoresByKey.get(createTaskItemKey("turn-command-history", "command-8"))?.peek(),
    ).not.toHaveProperty("output");
  });

  it("only scans and encodes the appended command output chunk", () => {
    const untouchedOutput = `untouched-${"x".repeat(1_000)}`;
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({
        turns: [
          {
            completedAt: null,
            error: null,
            id: "turn-running",
            items: [
              {
                command: "active",
                cwd: "/workspace",
                id: "command-active",
                output: "active",
                outputTruncated: false,
                status: "running",
                type: "command",
              },
              {
                command: "untouched",
                cwd: "/workspace",
                id: "command-untouched",
                output: untouchedOutput,
                outputTruncated: false,
                status: "completed",
                type: "command",
              },
            ],
            startedAt: timestamp,
            status: "running",
          },
        ],
      }),
    );
    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");
    const activeItemStore = store.getState().itemStoresByKey.get(runningItemKey("command-active"));
    if (activeItemStore === undefined) {
      throw new Error("Expected active command item store");
    }
    const readSpy = vi.spyOn(activeItemStore, "read");
    const previousCommandAccess = store.getState().commandOutputAccessByItemKey;
    const previousCommandBytes = store.getState().commandOutputBytesByItemKey;
    const retainedBytesBefore = store.getState().retainedBytes;

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "command-active",
        payload: { delta: "-delta" },
        turnId: "turn-running",
        type: "command.output_delta",
      },
    ]);

    try {
      expect(encodeSpy.mock.calls.map(([value]) => value)).toEqual(["-delta"]);
      expect(readSpy).not.toHaveBeenCalled();
      expect(store.getState().commandOutputAccessByItemKey).toBe(previousCommandAccess);
      expect(store.getState().commandOutputBytesByItemKey).toBe(previousCommandBytes);
      expect(store.getState().retainedBytes).toBe(retainedBytesBefore + 6);
      expect(store.getState().getItem("command-active", "turn-running")).toMatchObject({
        output: "active-delta",
      });
    } finally {
      encodeSpy.mockRestore();
      readSpy.mockRestore();
    }
  });

  it("uses terminal entities as authoritative while preserving confirmed errors", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const events: AgentEvent[] = [
      {
        ...eventEnvelope(11),
        payload: { message: "上游服务不可用", willRetry: false },
        turnId: "turn-running",
        type: "provider.error",
      },
      {
        ...eventEnvelope(12),
        itemId: "message-running",
        payload: {
          item: {
            id: "message-running",
            role: "assistant",
            text: "Item 权威终态",
            type: "message",
          },
        },
        turnId: "turn-running",
        type: "item.completed",
      },
      {
        ...eventEnvelope(13),
        payload: {
          turn: {
            completedAt: "2026-07-28T00:00:02.000Z",
            error: null,
            id: "turn-running",
            items: [
              {
                id: "message-running",
                role: "assistant",
                text: "Turn 权威终态",
                type: "message",
              },
            ],
            startedAt: timestamp,
            status: "failed",
          },
        },
        turnId: "turn-running",
        type: "turn.completed",
      },
    ];

    store.getState().applyEvents(events);
    const snapshot = store.getState().reconstructSnapshot();

    expect(snapshot?.status).toBe("failed");
    expect(snapshot?.turns[1]).toMatchObject({
      error: "上游服务不可用",
      items: [{ text: "Turn 权威终态" }],
      status: "failed",
    });
  });
});
