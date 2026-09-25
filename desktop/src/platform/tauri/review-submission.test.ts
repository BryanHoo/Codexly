import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { submitReview, type SubmitReviewOptions } from "./review-submission.js";
import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";
import { NativeCommandError } from "./native-client.js";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    id = 23;
    onmessage: (value: unknown) => void;
    constructor(onmessage: (value: unknown) => void) { this.onmessage = onmessage; }
  },
  invoke: vi.fn(),
}));
const unregisterCallback = vi.fn();
beforeEach(() => vi.stubGlobal("window", { __TAURI_INTERNALS__: { unregisterCallback } }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const task = { id: "task-a", projectId: "project-a", title: "Review", pinned: false, updatedAt: "2026-09-13T00:00:00Z" };
const result = { taskId: task.id, turn: { id: "review-a", status: "running", items: [], startedAt: "2026-09-13T00:00:00Z", completedAt: null, error: null } };
const options: SubmitReviewOptions = { projectId: "project-a", idempotencyKey: "review-key", target: { type: "base_branch", branch: "main" } };

test("client submits Review and its key in one command and deduplicates task delivery", async () => {
  const onTaskCreated = vi.fn();
  const invoke = vi.fn(async (_command: string, args: Record<string, unknown>) => {
    (args.onTaskCreated as { onmessage: (value: unknown) => void }).onmessage(task);
    expect(onTaskCreated).toHaveBeenCalledWith(task);
    return { createdTask: task, outcome: { type: "started", result } };
  });
  const client = new TauriSidebarClient({ ensureRuntime: async () => undefined, invoke: invoke as InvokeImplementation });
  await expect(client.submitReview({ ...options, onTaskCreated })).resolves.toEqual({ ...result, createdTask: task });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("submit_review", { request: options, onTaskCreated: expect.any(Object) });
  expect(onTaskCreated).toHaveBeenCalledTimes(1);
  expect(unregisterCallback).toHaveBeenCalledWith(23);
});

test("Review failure restores a created task when notification is lost", async () => {
  const onTaskCreated = vi.fn();
  const call = async () => ({ createdTask: task, outcome: { type: "failed", error: { code: "CODEX_THREAD_BUSY", message: "busy" } } });
  await expect(submitReview(call, { ...options, onTaskCreated })).rejects.toEqual(new NativeCommandError("CODEX_THREAD_BUSY", "busy"));
  expect(onTaskCreated).toHaveBeenCalledWith(task);
  expect(unregisterCallback).toHaveBeenCalledWith(23);
});

test("existing task Review requires no checkpoint or creation notification", async () => {
  const onTaskCreated = vi.fn();
  const call = async () => ({ createdTask: null, outcome: { type: "started", result } });
  await expect(submitReview(call, { ...options, taskId: task.id, onTaskCreated })).resolves.toEqual(result);
  expect(onTaskCreated).not.toHaveBeenCalled();
});

test("Review rejects malformed final responses and releases the channel", async () => {
  await expect(submitReview(async () => ({ createdTask: null, outcome: { type: "started", result: {} } }), options)).rejects.toThrow("Invalid review submission response");
  expect(unregisterCallback).toHaveBeenCalledWith(23);
});
