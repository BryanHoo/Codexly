import type { AgentTaskSnapshot } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { getTaskActivity } from "./task-activity.js";
import { createProjectRuntimeManager } from "./project-runtime.js";
import {
  createSnapshotResponse,
  createTurnCompletedEvent,
  createClientHarness,
} from "./project-runtime.test-support.js";

describe("project runtime lifecycle", () => {
  it("releases an inactive Project only after its idle timeout", () => {
    vi.useFakeTimers();
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client, { idleTimeoutMs: 1_000 });

    manager.observeSnapshot(createSnapshotResponse("task-1", { status: "idle" }));
    vi.advanceTimersByTime(999);
    expect(harness.closeConnection).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(harness.closeConnection).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("immediately forgets a removed Project runtime and task activity", () => {
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client);
    manager.observeSnapshot(createSnapshotResponse("task-1"));

    manager.forgetProject("project-1");

    expect(harness.closeConnection).toHaveBeenCalledOnce();
    expect(getTaskActivity(manager.getTaskActivity(), "project-1", "task-1")).toEqual({
      attention: null,
      isAwaitingApproval: false,
      isRunning: false,
    });
    manager.dispose();
  });

  it("keeps a running Project connected until its terminal event", () => {
    vi.useFakeTimers();
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client, { idleTimeoutMs: 1_000 });

    manager.observeSnapshot(createSnapshotResponse("task-1"));
    vi.advanceTimersByTime(10_000);
    expect(harness.closeConnection).not.toHaveBeenCalled();

    harness.emit(createTurnCompletedEvent("task-1", 1));
    vi.runOnlyPendingTimers();
    expect(harness.closeConnection).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("keeps an approval-blocked Project connected until the request resolves", () => {
    vi.useFakeTimers();
    const harness = createClientHarness();
    const manager = createProjectRuntimeManager(harness.client, { idleTimeoutMs: 1_000 });
    const pendingRequest: AgentTaskSnapshot["pendingRequests"][number] = {
      availableDecisions: ["allow", "deny"],
      command: "pnpm check",
      createdAt: "2026-07-28T00:00:00.000Z",
      cwd: "/workspace/Codexly",
      expiresAt: null,
      itemId: "item-approval",
      networkAccess: null,
      projectId: "project-1",
      reason: null,
      requestId: "approval-1",
      status: "pending",
      taskId: "task-1",
      turnId: "turn-task-1",
      type: "command_approval",
    };

    manager.observeSnapshot(
      createSnapshotResponse("task-1", { pendingRequests: [pendingRequest], status: "idle" }),
    );
    vi.advanceTimersByTime(10_000);
    expect(harness.closeConnection).not.toHaveBeenCalled();

    harness.emit({
      itemId: pendingRequest.itemId,
      payload: { request: { ...pendingRequest, status: "resolved" } },
      provider: "codex",
      sequence: 1,
      sessionId: "runtime-1",
      taskId: "task-1",
      timestamp: "2026-07-28T00:00:01.000Z",
      turnId: pendingRequest.turnId,
      type: "pending_request.resolved",
      version: 2,
    });
    vi.runOnlyPendingTimers();
    expect(harness.closeConnection).toHaveBeenCalledTimes(1);
    manager.dispose();
  });
});
