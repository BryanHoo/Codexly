import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentTask } from "../../protocol/index.js";

export function listenScheduledTaskStarted(listener: (task: AgentTask) => void): Promise<UnlistenFn> {
  return listen<AgentTask>("scheduled-task://started", (event) => listener(event.payload));
}
