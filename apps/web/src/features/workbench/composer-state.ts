import type {
  AgentCapabilities,
  AgentGlobalSettings,
  AgentPromptInput,
  AgentReviewTarget,
  AgentTask,
  AgentTaskSettings,
  AgentTaskSnapshot,
  AgentTurn,
  AgentTurnOptions,
  EventCheckpoint,
} from "@codexly/protocol";
import { v4 as createUuid } from "uuid";

import { i18n } from "../../i18n/i18n.js";
import type { TaskRuntimeView } from "../conversation/runtime/use-task-runtime.js";
import type { CodexlyMutationClient } from "../projects/project-queries.js";
import {
  applyApprovalMode as applySharedApprovalMode,
  deriveApprovalMode as deriveSharedApprovalMode,
  type ApprovalMode as SharedApprovalMode,
} from "../../shared/approval-mode.js";

export type ComposerState = "failed" | "idle" | "reconnecting" | "running" | "submitting";
export type ApprovalMode = SharedApprovalMode;

export function resolveThreadComposerSettings(
  settings: AgentTaskSettings,
  configuration: AgentTaskSnapshot["threadConfiguration"],
): AgentTaskSettings {
  // 续聊沿用原生线程模型；权限仍由应用设置决定，空字段独立回退。
  const model = configuration?.model ?? settings.model;
  const reasoningEffort = configuration?.reasoningEffort ?? settings.reasoningEffort;
  return model === settings.model && reasoningEffort === settings.reasoningEffort
    ? settings
    : { ...settings, model, reasoningEffort };
}

export const LARGE_PASTE_CHARACTER_THRESHOLD = 1_000;
export const PASTED_TEXT_ATTACHMENT_NAME = "Pasted text.txt";

export function resolveComposerPlaceholder(taskId: string | undefined): string {
  return taskId === undefined
    ? i18n.t("composer.placeholder", { ns: "workbench" })
    : i18n.t("composer.followUpPlaceholder", { ns: "workbench" });
}

export type IdempotencyAttempt = Readonly<{
  fingerprint: string;
  key: string;
}>;

export function resolveIdempotencyAttempt(
  previous: IdempotencyAttempt | undefined,
  fingerprint: string,
  createKey: () => string = createUuid,
): IdempotencyAttempt {
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: createKey() };
}

export function resolveReasoningEffort(
  model:
    | Readonly<{
        defaultReasoningEffort: string;
        supportedReasoningEfforts: readonly Readonly<{ id: string }>[];
      }>
    | undefined,
  requestedEffort: string,
): string | undefined {
  if (model === undefined) {
    return undefined;
  }
  return model.supportedReasoningEfforts.some((option) => option.id === requestedEffort)
    ? requestedEffort
    : model.defaultReasoningEffort;
}

export function deriveApprovalMode(
  settings: Pick<AgentTaskSettings, "approvalPolicy" | "approvalsReviewer">,
): ApprovalMode {
  return deriveSharedApprovalMode(settings);
}

export function applyApprovalMode(
  settings: AgentTaskSettings,
  mode: ApprovalMode,
): AgentTaskSettings {
  return applySharedApprovalMode(settings, mode);
}

export function deriveComposerActions(
  capabilities: AgentCapabilities | undefined,
  hasTask: boolean,
): Readonly<{ canInterrupt: boolean; canSubmit: boolean; canSteer: boolean }> {
  return {
    canInterrupt: capabilities?.turns.interrupt ?? false,
    canSubmit: capabilities?.turns.start === true && (hasTask || capabilities.tasks.start),
    canSteer: capabilities?.turns.steer === true && hasTask,
  };
}

export type ComposerSubmitAction = "blocked" | "interrupt" | "queue" | "start" | "steer";

export function resolveComposerSubmitAction(
  state: ComposerState,
  hasInput: boolean,
  followUpBehavior: AgentGlobalSettings["followUpBehavior"],
  canSteer: boolean,
): ComposerSubmitAction {
  if (state !== "running") {
    return hasInput ? "start" : "blocked";
  }
  if (!hasInput) {
    return "interrupt";
  }
  return followUpBehavior === "queue" ? "queue" : canSteer ? "steer" : "blocked";
}

export function deriveComposerState(
  input: Readonly<{
    activeTurnId: string | undefined;
    connectionState: TaskRuntimeView["connectionState"];
    isSubmitting?: boolean;
    mutationFailed?: boolean;
  }>,
): ComposerState {
  if (input.isSubmitting === true) {
    return "submitting";
  }
  if (
    input.connectionState === "closed" ||
    input.connectionState === "connecting" ||
    input.connectionState === "reconnecting"
  ) {
    return "reconnecting";
  }
  if (input.activeTurnId !== undefined) {
    return "running";
  }
  return input.mutationFailed === true ? "failed" : "idle";
}

export function deriveComposerInputAvailability(state: ComposerState): Readonly<{
  attachmentsDisabled: boolean;
  draftInputDisabled: boolean;
  turnControlsDisabled: boolean;
}> {
  return {
    // 草稿与附件都是本地输入，实时连接恢复期间不能禁用，否则浏览器会终止原生 IME 上下文。
    attachmentsDisabled: state === "submitting",
    draftInputDisabled: state === "submitting",
    turnControlsDisabled: state === "reconnecting" || state === "submitting",
  };
}

export function resolveActiveTurnId(
  snapshot:
    (Pick<AgentTaskSnapshot, "turns"> & Partial<Pick<AgentTaskSnapshot, "status">>) | undefined,
  submittedTurnId: string | undefined,
): string | undefined {
  const runningTurn = snapshot?.turns.findLast((turn) => turn.status === "running");
  if (runningTurn !== undefined) {
    return runningTurn.id;
  }
  const submittedTurn = snapshot?.turns.find((turn) => turn.id === submittedTurnId);
  return submittedTurn === undefined || submittedTurn.status === "running"
    ? submittedTurnId
    : undefined;
}

type StartPromptTurnOptions = Readonly<{
  idempotencyKeys: Readonly<{ startTask?: string; startTurn: string }>;
  input: AgentPromptInput;
  onTaskCreated?: (task: AgentTask) => void;
  projectId: string;
  taskId?: string;
  turnOptions: AgentTurnOptions;
}>;

export async function startPromptTurn(
  client: Pick<CodexlyMutationClient, "startTask" | "startTurn">,
  options: StartPromptTurnOptions,
): Promise<
  Readonly<{
    checkpoint: EventCheckpoint;
    createdTask?: AgentTask;
    taskId: string;
    turn: AgentTurn;
  }>
> {
  let taskId = options.taskId;
  let createdTask: AgentTask | undefined;
  if (taskId === undefined) {
    const startTaskKey = options.idempotencyKeys.startTask;
    if (startTaskKey === undefined) {
      throw new Error("Task creation requires an idempotency key");
    }
    const response = await client.startTask(options.projectId, {
      idempotencyKey: startTaskKey,
    });
    createdTask = response.task;
    taskId = response.task.id;
    options.onTaskCreated?.(response.task);
  }
  const response = await client.startTurn(
    options.projectId,
    taskId,
    options.input,
    options.turnOptions,
    {
      idempotencyKey: options.idempotencyKeys.startTurn,
    },
  );
  return {
    checkpoint: response.checkpoint,
    ...(createdTask === undefined ? {} : { createdTask }),
    taskId,
    turn: response.turn,
  };
}

type StartTaskReviewOptions = Readonly<{
  idempotencyKey: string;
  onTaskCreated?: (task: AgentTask) => void;
  projectId: string;
  target: AgentReviewTarget;
  taskId?: string;
}>;

export async function startTaskReview(
  client: Pick<CodexlyMutationClient, "startReview" | "startTask">,
  options: StartTaskReviewOptions,
): Promise<Readonly<{ createdTask?: AgentTask; taskId: string; turn: AgentTurn }>> {
  let taskId = options.taskId;
  let createdTask: AgentTask | undefined;
  if (taskId === undefined) {
    const response = await client.startTask(options.projectId, {
      idempotencyKey: options.idempotencyKey,
    });
    createdTask = response.task;
    taskId = response.task.id;
    options.onTaskCreated?.(response.task);
  }
  const response = await client.startReview(
    options.projectId,
    taskId,
    { target: options.target },
    { idempotencyKey: options.idempotencyKey },
  );
  return {
    ...(createdTask === undefined ? {} : { createdTask }),
    taskId,
    turn: response.turn,
  };
}

export function interruptPromptTurn(
  client: Pick<CodexlyMutationClient, "interruptTurn">,
  projectId: string,
  taskId: string,
  turnId: string,
  idempotencyKey: string,
) {
  return client.interruptTurn(projectId, taskId, turnId, { idempotencyKey });
}

export function steerPromptTurn(
  client: Pick<CodexlyMutationClient, "steerTurn">,
  projectId: string,
  taskId: string,
  turnId: string,
  input: AgentPromptInput,
  idempotencyKey: string,
) {
  return client.steerTurn(projectId, taskId, turnId, input, { idempotencyKey });
}
