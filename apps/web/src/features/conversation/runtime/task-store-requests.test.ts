import type { AgentEvent, PendingRequest } from "@code-agent/protocol";
import { describe, expect, it } from "vitest";
import { createTaskStore, MAX_RETAINED_TERMINAL_REQUESTS } from "./task-store.js";
import { createResponse, eventEnvelope, createPendingRequest } from "./task-store.test-support.js";

describe("task store pending requests", () => {
  it("tracks usage and pending request lifecycle without reordering requests", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const pendingRequest = createPendingRequest();
    const resolvedRequest = createPendingRequest("resolved");

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: { usage: { contextWindow: 200_000, usedTokens: 25_000 } },
        turnId: "turn-running",
        type: "usage.updated",
      },
      {
        ...eventEnvelope(12),
        itemId: pendingRequest.itemId,
        payload: { request: pendingRequest },
        turnId: pendingRequest.turnId,
        type: "pending_request.created",
      },
      {
        ...eventEnvelope(13),
        itemId: resolvedRequest.itemId,
        payload: { request: resolvedRequest },
        turnId: resolvedRequest.turnId,
        type: "pending_request.resolved",
      },
    ]);

    const state = store.getState();
    expect(state.snapshotMetadata?.contextUsage).toEqual({
      contextWindow: 200_000,
      usedTokens: 25_000,
    });
    expect(state.pendingRequestIds).toEqual(["request-1"]);
    expect(state.pendingRequestsById["request-1"]?.status).toBe("resolved");
  });

  it("bounds terminal requests and reconstructs only active pending requests", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const activeRequest = {
      ...createPendingRequest(),
      requestId: "request-active",
    } as PendingRequest & Readonly<{ status: "pending" }>;
    const lateTerminalRequest = {
      ...createPendingRequest(),
      requestId: "request-late-terminal",
    } as PendingRequest & Readonly<{ status: "pending" }>;
    const overflowCount = 5;
    const terminalEvents: AgentEvent[] = Array.from(
      { length: MAX_RETAINED_TERMINAL_REQUESTS + overflowCount },
      (_, index) => {
        const requestId = `request-terminal-${String(index)}`;
        if (index % 2 === 0) {
          const request = {
            ...createPendingRequest("resolved"),
            requestId,
          } as PendingRequest & Readonly<{ status: "resolved" }>;
          return {
            ...eventEnvelope(index + 13),
            itemId: request.itemId,
            payload: { request },
            turnId: request.turnId,
            type: "pending_request.resolved",
          };
        }
        const request = {
          ...createPendingRequest("expired"),
          requestId,
        } as PendingRequest & Readonly<{ status: "expired" }>;
        return {
          ...eventEnvelope(index + 13),
          itemId: request.itemId,
          payload: { request },
          turnId: request.turnId,
          type: "pending_request.expired",
        };
      },
    );

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: activeRequest.itemId,
        payload: { request: activeRequest },
        turnId: activeRequest.turnId,
        type: "pending_request.created",
      },
      {
        ...eventEnvelope(12),
        itemId: lateTerminalRequest.itemId,
        payload: { request: lateTerminalRequest },
        turnId: lateTerminalRequest.turnId,
        type: "pending_request.created",
      },
      ...terminalEvents,
      {
        ...eventEnvelope(terminalEvents.length + 13),
        itemId: lateTerminalRequest.itemId,
        payload: { request: { ...lateTerminalRequest, status: "resolved" } },
        turnId: lateTerminalRequest.turnId,
        type: "pending_request.resolved",
      },
    ]);

    const state = store.getState();
    expect(state.pendingRequestIds).toEqual([
      "request-active",
      ...Array.from(
        { length: MAX_RETAINED_TERMINAL_REQUESTS - 1 },
        (_, index) => `request-terminal-${String(index + overflowCount + 1)}`,
      ),
      "request-late-terminal",
    ]);
    expect(state.pendingRequestsById["request-active"]).toBe(activeRequest);
    expect(state.pendingRequestsById["request-terminal-4"]).toBeUndefined();
    expect(state.reconstructSnapshot()?.pendingRequests).toEqual([activeRequest]);
  });

  it("rejects wrong identities and deduplicates old sequences", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const validEvent: AgentEvent = {
      ...eventEnvelope(11),
      itemId: "message-running",
      payload: { delta: "一次" },
      turnId: "turn-running",
      type: "message.delta",
    };
    const wrongTaskEvent = { ...validEvent, sequence: 12, taskId: "task-other" };
    const wrongSessionEvent = { ...validEvent, sequence: 13, sessionId: "session-other" };

    store.getState().applyEvents([validEvent, validEvent, wrongTaskEvent, wrongSessionEvent]);

    expect(store.getState().getItem("message-running", "turn-running")).toMatchObject({
      text: "开始一次",
    });
    expect(store.getState().checkpoint?.sequence).toBe(11);
    expect(() => {
      store.getState().hydrate(createResponse({ id: "task-other" }));
    }).toThrow(/identity/);
  });

  it("updates connection and error state independently", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    const connectionError = new Error("连接中断");

    store.getState().setConnectionState("reconnecting");
    store.getState().setError(connectionError);

    expect(store.getState()).toMatchObject({
      connectionState: "reconnecting",
      error: connectionError,
    });
  });
});
