import type { AgentItem, AgentQueuedSubmission, AgentSkill, AgentTurn } from "@codexly/protocol";

import type { PromptInputAttachment } from "../../shared/components/agent/prompt-input.js";
import type { TaskStoreState } from "../conversation/runtime/task-store.js";

type ComposerPrompt = Readonly<{
  files: readonly PromptInputAttachment[];
  id: string;
  skills: readonly AgentSkill[];
  text: string;
}>;

export type QueuedComposerPrompt = ComposerPrompt &
  (
    | Readonly<{ status: "queued" }>
    | Readonly<{
        status: "awaiting-response";
        turnId: string;
        userMessageIds: readonly string[];
      }>
  );

export type AcceptedSteerPrompt = Readonly<{
  files: QueuedComposerPrompt["files"];
  id?: string;
  skills: QueuedComposerPrompt["skills"];
  text: string;
  turnId: string;
  userMessageIds: readonly string[];
}>;

export function mapAgentQueuedSubmission(
  submission: AgentQueuedSubmission,
  projectId: string,
  taskId: string,
  getAttachmentUrl: (projectId: string, taskId: string, attachmentId: string) => string,
  availableSkills: readonly AgentSkill[],
): QueuedComposerPrompt {
  const skillsById = new Map(availableSkills.map((skill) => [skill.id, skill]));
  return {
    files: submission.attachments.map((attachment) => ({
      attachment,
      ...attachment,
      previewUrl: getAttachmentUrl(projectId, taskId, attachment.id),
      source: "host" as const,
    })),
    id: submission.id,
    skills: submission.skills.map(
      (skill) =>
        skillsById.get(skill.id) ?? {
          description: "",
          displayName: skill.name,
          id: skill.id,
          name: skill.name,
          scope: "repo" as const,
        },
    ),
    status: "queued",
    text: submission.text,
  };
}

type TaskMessageSnapshot = Readonly<{
  turns: readonly Readonly<{
    id: string;
    items: readonly AgentItem[];
    status: AgentTurn["status"];
  }>[];
}>;

export function retainAcceptedSteerPrompt(
  prompts: readonly QueuedComposerPrompt[],
  accepted: AcceptedSteerPrompt,
  createId: () => string,
): readonly QueuedComposerPrompt[] {
  const waitingPrompt: QueuedComposerPrompt = {
    files: accepted.files,
    id: accepted.id ?? createId(),
    skills: accepted.skills,
    status: "awaiting-response",
    text: accepted.text,
    turnId: accepted.turnId,
    userMessageIds: accepted.userMessageIds,
  };
  if (accepted.id === undefined || !prompts.some((prompt) => prompt.id === accepted.id)) {
    return [...prompts, waitingPrompt];
  }
  return prompts.map((prompt) => (prompt.id === accepted.id ? waitingPrompt : prompt));
}

function getUserMessageIds(items: readonly AgentItem[]): readonly string[] {
  return items.flatMap((item) =>
    item.type === "message" && item.role === "user" ? [item.id] : [],
  );
}

export function getTurnUserMessageIds(
  snapshot: TaskMessageSnapshot | undefined,
  turnId: string | undefined,
): readonly string[] {
  if (turnId === undefined) {
    return [];
  }
  const turn = snapshot?.turns.find((candidate) => candidate.id === turnId);
  return getUserMessageIds(turn?.items ?? []);
}

export function getTaskStoreUserMessageIds(
  state: Pick<TaskStoreState, "getItemByKey" | "itemKeysByTurnId">,
  turnId: string | undefined,
): readonly string[] {
  if (turnId === undefined) {
    return [];
  }
  return getUserMessageIds(
    (state.itemKeysByTurnId[turnId] ?? []).flatMap((itemId) => {
      const item = state.getItemByKey(itemId);
      return item === undefined ? [] : [item];
    }),
  );
}

export function hasQueuedPromptReceivedUserMessage(
  prompt: QueuedComposerPrompt,
  currentUserMessageIds: readonly string[],
): boolean {
  if (prompt.status !== "awaiting-response") {
    return false;
  }
  const previousUserMessageIds = new Set(prompt.userMessageIds);
  return currentUserMessageIds.some((id) => !previousUserMessageIds.has(id));
}

function isAwaitingSteerFinished(
  prompt: Extract<QueuedComposerPrompt, { status: "awaiting-response" }>,
  userMessageIds: readonly string[],
  turnStatus: AgentTurn["status"] | undefined,
): boolean {
  // 中断后不会再产生引导对应的用户消息，必须以权威终态结束本地 loading。
  return turnStatus === "interrupted" || hasQueuedPromptReceivedUserMessage(prompt, userMessageIds);
}

export function hasQueuedPromptFinishedInSnapshot(
  prompt: QueuedComposerPrompt,
  snapshot: TaskMessageSnapshot | undefined,
): boolean {
  if (prompt.status !== "awaiting-response") {
    return false;
  }
  const turn = snapshot?.turns.find((candidate) => candidate.id === prompt.turnId);
  return isAwaitingSteerFinished(prompt, getUserMessageIds(turn?.items ?? []), turn?.status);
}

export function hasQueuedPromptFinishedInStore(
  prompt: QueuedComposerPrompt,
  state: Pick<TaskStoreState, "getItemByKey" | "itemKeysByTurnId" | "turnsById">,
): boolean {
  if (prompt.status !== "awaiting-response") {
    return false;
  }
  return isAwaitingSteerFinished(
    prompt,
    getTaskStoreUserMessageIds(state, prompt.turnId),
    state.turnsById[prompt.turnId]?.status,
  );
}

export function resolveQueuedPromptEdit(
  prompt: QueuedComposerPrompt,
): Pick<QueuedComposerPrompt, "files" | "skills" | "text"> | undefined {
  return prompt.status === "queued"
    ? { files: prompt.files, skills: prompt.skills, text: prompt.text }
    : undefined;
}
