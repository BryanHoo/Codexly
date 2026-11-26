import type {
  AgentMessageAttachment,
  AgentPromptInput,
  AgentTask,
  AgentTaskSettings,
  AgentTaskSnapshot,
  AgentTurn,
  EventCheckpoint,
} from "@/protocol/index.js";

import { mergeSubmittedPromptIntoSnapshot } from "../../conversation/runtime/task-runtime.js";

export function taskLaunchQueryKey(projectId: string, taskId: string) {
  return ["projects", projectId, "tasks", taskId, "launch"] as const;
}

export type TaskLaunchState = Readonly<{
  checkpoint: EventCheckpoint;
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  submissionStartedAt?: string;
  task: AgentTask;
  turn: AgentTurn;
}> & (Readonly<{ settings: AgentTaskSettings; runtime?: never; snapshot?: never }> |
  Readonly<{ runtime: "acp"; settings?: never; snapshot: Extract<AgentTaskSnapshot, { runtime: "acp" }> }>);

export function createTaskLaunchSnapshot(taskLaunchState: TaskLaunchState): AgentTaskSnapshot {
  const snapshot = mergeSubmittedPromptIntoSnapshot(
    taskLaunchState.runtime === "acp" ? taskLaunchState.snapshot : {
      ...taskLaunchState.task,
      contextUsage: null,
      goal: null,
      plan: null,
      pendingRequests: [],
      settings: taskLaunchState.settings,
      status: "running",
      turns: [taskLaunchState.turn],
      turnsNextCursor: null,
    },
    taskLaunchState.turn,
    { ...taskLaunchState.input, messageAttachments: taskLaunchState.messageAttachments },
  );
  // 权威快照内可能已有 ACP 审批，不因首屏接管而清空。
  return snapshot;
}
