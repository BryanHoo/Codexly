import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { submitPrompt, type SubmitPromptOptions } from "./prompt-submission.js";
import { NativeCommandError } from "./native-client.js";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    id = 17;
    onmessage: (value: unknown) => void;
    constructor(onmessage: (value: unknown) => void) { this.onmessage = onmessage; }
  },
  invoke: vi.fn(),
}));

const task = { id: "task-a", projectId: "project-a", title: "Task", pinned: false, updatedAt: "2026-09-13T00:00:00Z" };
const result = {
  taskId: task.id,
  checkpoint: { sequence: 1, sessionId: "runtime-a" },
  turn: { id: "turn-a", status: "running", items: [], startedAt: "2026-09-13T00:00:00Z", completedAt: null, error: null },
};
const options: SubmitPromptOptions = {
  projectId: "project-a",
  idempotencyKeys: { startTask: "task-key", startTurn: "turn-key" },
  input: { type: "prompt", text: "hello", attachments: [], skills: [] },
  turnOptions: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model-a", reasoningEffort: "high", sandboxMode: "workspace-write" },
};
const unregisterCallback = vi.fn();
beforeEach(() => { vi.stubGlobal("window", { __TAURI_INTERNALS__: { unregisterCallback } }); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

test("publishes task before completion and deduplicates final response", async () => {
  const onTaskCreated = vi.fn();
  const call = vi.fn(async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
    expect(command).toBe("submit_prompt");
    expect(args.request).toEqual(options);
    (args.onTaskCreated as { onmessage: (value: unknown) => void }).onmessage(task);
    expect(onTaskCreated).toHaveBeenCalledWith(task);
    return { createdTask: task, outcome: { type: "started", result } } as T;
  });
  await expect(submitPrompt(call, { ...options, onTaskCreated })).resolves.toEqual({ ...result, createdTask: task });
  expect(call).toHaveBeenCalledTimes(1);
  expect(onTaskCreated).toHaveBeenCalledTimes(1);
  expect(unregisterCallback).toHaveBeenCalledWith(17);
});

test("recovers created task from final failure if notification is lost", async () => {
  const onTaskCreated = vi.fn();
  const call = async <T>(): Promise<T> => ({ createdTask: task, outcome: { type: "failed", error: { code: "CODEX_THREAD_BUSY", message: "busy" } } }) as T;
  await expect(submitPrompt(call, { ...options, onTaskCreated })).rejects.toEqual(new NativeCommandError("CODEX_THREAD_BUSY", "busy"));
  expect(onTaskCreated).toHaveBeenCalledWith(task);
  expect(unregisterCallback).toHaveBeenCalledWith(17);
});

test("existing task returns turn without a creation callback", async () => {
  const onTaskCreated = vi.fn();
  const call = async <T>(): Promise<T> => ({ createdTask: null, outcome: { type: "started", result } }) as T;
  await expect(submitPrompt(call, { ...options, taskId: task.id, onTaskCreated })).resolves.toEqual(result);
  expect(onTaskCreated).not.toHaveBeenCalled();
});

test("releases notification callback on transport failure", async () => {
  const failure = new Error("connection lost");
  await expect(submitPrompt(async () => { throw failure; }, options)).rejects.toBe(failure);
  expect(unregisterCallback).toHaveBeenCalledWith(17);
});

test("rejects invalid native payload and ignores late notifications", async () => {
  const onTaskCreated = vi.fn();
  let channel: { onmessage: (value: unknown) => void } | undefined;
  const call = async <T>(_command: string, args: Record<string, unknown>): Promise<T> => {
    channel = args.onTaskCreated as typeof channel;
    channel?.onmessage({ id: "invalid" });
    return { createdTask: null, outcome: { type: "started", result: {} } } as T;
  };
  await expect(submitPrompt(call, { ...options, onTaskCreated })).rejects.toThrow("Invalid prompt submission response");
  channel?.onmessage(task);
  expect(onTaskCreated).not.toHaveBeenCalled();
});
