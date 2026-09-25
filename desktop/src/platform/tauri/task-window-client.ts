import { Channel } from "@tauri-apps/api/core";
import type { TaskWindowPacket } from "../../protocol/task-window.js";
import { invoke } from "./native-invoke.js";

export function openTaskWindow(projectId: string, taskId: string): Promise<void> {
  const root = typeof document === "undefined" ? undefined : document.documentElement;
  return invoke("open_task_window", {
    projectId, taskId, theme: root?.dataset["theme"] ?? "system", language: root?.lang || "zh-CN",
  });
}

export function restoreTaskWindow(): Promise<void> {
  return invoke("restore_task_window");
}

export function closeTaskWindow(): Promise<void> {
  return invoke("close_task_window");
}

export function dragTaskWindow(): Promise<void> {
  return invoke("drag_task_window");
}

export function acknowledgeTaskWindow(sequence: number): Promise<void> {
  return invoke("acknowledge_task_window", { sequence });
}

export async function connectTaskWindow(onPacket: (packet: TaskWindowPacket) => void): Promise<() => void> {
  const channel = new Channel<TaskWindowPacket>();
  channel.onmessage = onPacket;
  await invoke("connect_task_window", { onUpdate: channel });
  // 原生状态随窗口销毁；重挂载只替换自己的 Channel，不干扰主 Runtime。
  return () => { channel.onmessage = () => undefined; };
}
