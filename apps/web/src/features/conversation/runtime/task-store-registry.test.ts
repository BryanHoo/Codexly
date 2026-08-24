import type { PendingRequest } from "@codexly/protocol";
import { describe, expect, it } from "vitest";
import {
  createTaskStore,
  createTaskStoreRegistry,
  estimateTaskStoreRetainedBytes,
} from "./task-store.js";
import { createResponse, createPendingRequest } from "./task-store.test-support.js";

describe("task store registry", () => {
  it("reuses a composite identity and isolates equal task ids across projects", () => {
    const registry = createTaskStoreRegistry({ maxRetainedStores: 3 });

    const firstStore = registry.acquire("project-1", "task-1");
    const reusedStore = registry.acquire("project-1", "task-1");
    const otherProjectStore = registry.acquire("project-2", "task-1");

    expect(reusedStore).toBe(firstStore);
    expect(otherProjectStore).not.toBe(firstStore);
  });

  it("evicts only the least-recently-used safe store and recreates it later", () => {
    const registry = createTaskStoreRegistry({ maxRetainedStores: 1 });
    const firstStore = registry.acquire("project-1", "task-1");
    firstStore.getState().hydrate(createResponse({ status: "idle" }));
    registry.release("project-1", "task-1");

    const secondStore = registry.acquire("project-1", "task-2");
    expect(registry.peek("project-1", "task-1")).toBe(firstStore);
    secondStore.getState().hydrate(createResponse({ id: "task-2", status: "idle" }));
    registry.release("project-1", "task-2");

    expect(registry.peek("project-1", "task-1")).toBeUndefined();
    expect(registry.acquire("project-1", "task-1")).not.toBe(firstStore);
    expect(secondStore).not.toBe(firstStore);
  });

  it("retains consumed stores and evicts every inactive store when retention is disabled", () => {
    const registry = createTaskStoreRegistry({ maxRetainedStores: 0 });

    const consumedStore = registry.acquire("project-1", "task-consumed");
    expect(registry.peek("project-1", "task-consumed")).toBe(consumedStore);

    registry.acquire("project-1", "task-unhydrated");
    registry.release("project-1", "task-unhydrated");
    expect(registry.peek("project-1", "task-unhydrated")).toBeUndefined();

    const runningStore = registry.acquire("project-1", "task-running");
    runningStore.getState().hydrate(createResponse({ id: "task-running", status: "running" }));
    registry.release("project-1", "task-running");
    expect(registry.peek("project-1", "task-running")).toBeUndefined();

    const pendingStore = registry.acquire("project-1", "task-pending");
    const pendingRequest = {
      ...createPendingRequest(),
      taskId: "task-pending",
      status: "pending" as const,
    } as PendingRequest & Readonly<{ status: "pending" }>;
    pendingStore.getState().hydrate(
      createResponse({
        id: "task-pending",
        pendingRequests: [pendingRequest],
        status: "idle",
      }),
    );
    registry.release("project-1", "task-pending");
    expect(registry.peek("project-1", "task-pending")).toBeUndefined();
  });

  it("evicts inactive stores by aggregate retained bytes", () => {
    const firstStore = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({ title: "first".repeat(200) }),
    );
    const singleStoreBytes = estimateTaskStoreRetainedBytes(firstStore);
    const registry = createTaskStoreRegistry({
      createStore: (identity) =>
        identity.taskId === "task-1"
          ? firstStore
          : createTaskStore(identity, createResponse({ id: identity.taskId })),
      maxRetainedBytes: singleStoreBytes + 100,
      maxRetainedStores: 10,
    });

    registry.acquire("project-1", "task-1");
    registry.release("project-1", "task-1");
    registry.acquire("project-1", "task-2");
    registry.release("project-1", "task-2");

    expect(registry.peek("project-1", "task-1")).toBeUndefined();
    expect(registry.peek("project-1", "task-2")).toBeDefined();
  });
});
