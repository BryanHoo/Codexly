import { Channel } from "@tauri-apps/api/core";
import { Value } from "@sinclair/typebox/value";
import { AgentTaskSchema, type AgentTask } from "@/protocol/agent-attachments.js";
import type { TaskSubmissionResponse } from "@/protocol/task-submission.js";
import { normalizeNativeError } from "./native-client.js";

export type SubmissionCall = (command: string, args: Record<string, unknown>) => Promise<unknown>;

export async function submitTask<T extends object>(
  call: SubmissionCall,
  command: string,
  request: unknown,
  decode: (value: unknown) => TaskSubmissionResponse<T>,
  onTaskCreated?: (task: AgentTask) => void,
): Promise<T & Readonly<{ createdTask?: AgentTask }>> {
  let notifiedTaskId: string | undefined;
  const notify = (task: AgentTask) => {
    if (task.id === notifiedTaskId) return;
    notifiedTaskId = task.id;
    onTaskCreated?.(task);
  };
  const channel = new Channel<unknown>((value) => {
    if (Value.Check(AgentTaskSchema, value)) notify(value);
  });
  try {
    const response = decode(await call(command, { request, onTaskCreated: channel }));
    // Channel 丢失或晚于响应时仍补入已创建任务；部分失败不能丢弃恢复入口。
    if (response.createdTask !== null) notify(response.createdTask);
    if (response.outcome.type === "failed") throw normalizeNativeError(response.outcome.error);
    return { ...response.outcome.result, ...(response.createdTask === null ? {} : { createdTask: response.createdTask }) };
  } finally {
    channel.onmessage = () => undefined;
    // Tauri Channel 没有公开 dispose，结束后释放一次性回调，避免重复提交累积监听器。
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { unregisterCallback: (id: number) => void } }).__TAURI_INTERNALS__;
    internals?.unregisterCallback(channel.id);
  }
}
