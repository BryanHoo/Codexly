import type {
  AgentMessageAttachment,
  AgentPromptInput,
  AgentTask,
  AgentTaskSettings,
  AgentTaskSnapshot,
  AgentTurn,
  EventCheckpoint,
} from "@codexly/protocol";

import { mergeSubmittedPromptIntoSnapshot } from "../../conversation/runtime/task-runtime.js";

export function taskLaunchQueryKey(projectId: string, taskId: string) {
  return ["projects", projectId, "tasks", taskId, "launch"] as const;
}

export type TaskLaunchState = Readonly<{
  checkpoint: EventCheckpoint;
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  settings: AgentTaskSettings;
  submissionStartedAt?: string;
  task: AgentTask;
  turn: AgentTurn;
}>;

export function createTaskLaunchSnapshot(taskLaunchState: TaskLaunchState): AgentTaskSnapshot {
  const snapshot = mergeSubmittedPromptIntoSnapshot(
    {
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
  return { ...snapshot, pendingRequests: [] };
}
