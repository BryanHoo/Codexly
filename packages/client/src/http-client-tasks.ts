import {
  AgentAttachmentUploadResponseSchema,
  AddAgentQueuedSubmissionResponseSchema,
  AgentQueuedSubmissionPageSchema,
  AgentBackgroundTerminalPageSchema,
  AgentMutationErrorSchema,
  AgentTaskPageSchema,
  AgentTaskSettingsResponseSchema,
  AgentTaskSnapshotResponseSchema,
  CompactAgentTaskResponseSchema,
  DeleteAgentQueuedSubmissionResponseSchema,
  ForkAgentTaskResponseSchema,
  InterruptAgentTurnResponseSchema,
  OpenAgentTaskAttachmentResponseSchema,
  PinAgentTaskResponseSchema,
  RenameAgentTaskResponseSchema,
  ResolvePendingRequestResponseSchema,
  ReorderAgentQueuedSubmissionsResponseSchema,
  ReviewAgentTaskResponseSchema,
  StartAgentTaskResponseSchema,
  StartAgentQueuedSubmissionResponseSchema,
  StartAgentTurnResponseSchema,
  SteerAgentTurnResponseSchema,
  TerminateAgentBackgroundTerminalResponseSchema,
  UpdateAgentQueuedSubmissionResponseSchema,
  UnsubscribeAgentTaskResponseSchema,
  UploadAgentFeedbackResponseSchema,
  type AgentAttachmentUploadResponse,
  type AddAgentQueuedSubmissionResponse,
  type AgentBackgroundTerminalPage,
  type AgentPromptInput,
  type AgentQueuedSubmissionPage,
  type AgentTaskPage,
  type AgentTaskSettings,
  type AgentTaskSettingsResponse,
  type AgentTaskSnapshotResponse,
  type AgentTurnOptions,
  type CompactAgentTaskResponse,
  type DeleteAgentQueuedSubmissionResponse,
  type ForkAgentTaskRequest,
  type ForkAgentTaskResponse,
  type HostFileKind,
  type InterruptAgentTurnResponse,
  type OpenAgentTaskAttachmentResponse,
  type PendingRequest,
  type PinAgentTaskResponse,
  type RenameAgentTaskResponse,
  type ResolvePendingRequestRequest,
  type ResolvePendingRequestResponse,
  type ReorderAgentQueuedSubmissionsResponse,
  type ReviewAgentTaskRequest,
  type ReviewAgentTaskResponse,
  type StartAgentTaskResponse,
  type StartAgentQueuedSubmissionResponse,
  type StartAgentTurnResponse,
  type SteerAgentTurnResponse,
  type TerminateAgentBackgroundTerminalResponse,
  type UpdateAgentQueuedSubmissionResponse,
  type UnsubscribeAgentTaskResponse,
  type UploadAgentFeedbackRequest,
  type UploadAgentFeedbackResponse,
} from "@code-agent/protocol";
import { v4 as createUuid } from "uuid";

import {
  appendQuery,
  buildTaskAttachmentUrl,
  projectPath,
  taskPath,
  type AgentAttachmentUploadInput,
  type ListTasksOptions,
  type MutationOptions,
  type PendingRequestResolution,
  type ReadOptions,
  type ReadTaskOptions,
} from "./http-client-transport.js";
import { TaskArchiveHttpClient } from "./http-client-task-archive.js";

export class TaskHttpClient extends TaskArchiveHttpClient {
  public async listQueuedSubmissions(
    projectId: string,
    taskId: string,
    input: Readonly<{ cursor?: string; limit?: number }> = {},
    options: ReadOptions = {},
  ): Promise<AgentQueuedSubmissionPage> {
    return this.read(
      appendQuery(`${taskPath(projectId, taskId)}/queue`, input),
      AgentQueuedSubmissionPageSchema,
      options,
    );
  }

  public async addQueuedSubmission(
    projectId: string,
    taskId: string,
    input: AgentPromptInput,
    clientUserMessageId: string,
    options: MutationOptions = {},
  ): Promise<AddAgentQueuedSubmissionResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/queue`,
      { clientUserMessageId, input },
      AddAgentQueuedSubmissionResponseSchema,
      options,
    );
  }

  public async updateQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    input: AgentPromptInput,
    options: MutationOptions = {},
  ): Promise<UpdateAgentQueuedSubmissionResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/queue/${encodeURIComponent(queuedSubmissionId)}`,
      { input },
      UpdateAgentQueuedSubmissionResponseSchema,
      options,
      "PUT",
    );
  }

  public async deleteQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    options: MutationOptions = {},
  ): Promise<DeleteAgentQueuedSubmissionResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/queue/${encodeURIComponent(queuedSubmissionId)}`,
      {},
      DeleteAgentQueuedSubmissionResponseSchema,
      options,
      "DELETE",
    );
  }

  public async reorderQueuedSubmissions(
    projectId: string,
    taskId: string,
    queuedSubmissionIds: readonly string[],
    options: MutationOptions = {},
  ): Promise<ReorderAgentQueuedSubmissionsResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/queue/reorder`,
      { queuedSubmissionIds },
      ReorderAgentQueuedSubmissionsResponseSchema,
      options,
      "PUT",
    );
  }

  public async startQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId?: string,
    options: MutationOptions = {},
  ): Promise<StartAgentQueuedSubmissionResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/queue/start`,
      { ...(queuedSubmissionId === undefined ? {} : { queuedSubmissionId }) },
      StartAgentQueuedSubmissionResponseSchema,
      options,
    );
  }

  public async listTasks(
    projectId: string,
    options: ListTasksOptions = {},
    requestOptions: ReadOptions = {},
  ): Promise<AgentTaskPage> {
    const path = appendQuery(`${projectPath(projectId)}/tasks`, options);
    return this.read(path, AgentTaskPageSchema, requestOptions);
  }

  public async readTask(
    projectId: string,
    taskId: string,
    options: ReadTaskOptions = {},
  ): Promise<AgentTaskSnapshotResponse> {
    const { cursor, ...readOptions } = options;
    return this.read(
      appendQuery(taskPath(projectId, taskId), { cursor }),
      AgentTaskSnapshotResponseSchema,
      readOptions,
    );
  }

  public getTaskAttachmentUrl(projectId: string, taskId: string, attachmentId: string): string {
    return buildTaskAttachmentUrl(this.baseUrl, projectId, taskId, attachmentId);
  }

  public async openTaskAttachment(
    projectId: string,
    taskId: string,
    attachmentId: string,
    options: MutationOptions = {},
  ): Promise<OpenAgentTaskAttachmentResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/attachments/${encodeURIComponent(attachmentId)}/open`,
      {},
      OpenAgentTaskAttachmentResponseSchema,
      options,
    );
  }

  public async listBackgroundTerminals(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AgentBackgroundTerminalPage> {
    return this.read(
      `${taskPath(projectId, taskId)}/background-terminals`,
      AgentBackgroundTerminalPageSchema,
      options,
    );
  }

  public async terminateBackgroundTerminal(
    projectId: string,
    taskId: string,
    terminalId: string,
    options: MutationOptions = {},
  ): Promise<TerminateAgentBackgroundTerminalResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/background-terminals/${encodeURIComponent(terminalId)}/terminate`,
      {},
      TerminateAgentBackgroundTerminalResponseSchema,
      options,
    );
  }

  public async getTaskSettings(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AgentTaskSettingsResponse> {
    return this.read(
      `${taskPath(projectId, taskId)}/settings`,
      AgentTaskSettingsResponseSchema,
      options,
    );
  }

  public async updateTaskSettings(
    projectId: string,
    taskId: string,
    settings: AgentTaskSettings,
    options: MutationOptions = {},
  ): Promise<AgentTaskSettingsResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/settings`,
      settings,
      AgentTaskSettingsResponseSchema,
      options,
      "PUT",
    );
  }

  public async startTask(
    projectId: string,
    options: MutationOptions = {},
  ): Promise<StartAgentTaskResponse> {
    return this.mutation(
      `${projectPath(projectId)}/tasks`,
      {},
      StartAgentTaskResponseSchema,
      options,
    );
  }

  public async pinTask(
    projectId: string,
    taskId: string,
    pinned: boolean,
    options: MutationOptions = {},
  ): Promise<PinAgentTaskResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/pin`,
      { pinned },
      PinAgentTaskResponseSchema,
      options,
      "PUT",
    );
  }

  public async renameTask(
    projectId: string,
    taskId: string,
    title: string,
    options: MutationOptions = {},
  ): Promise<RenameAgentTaskResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/rename`,
      { title },
      RenameAgentTaskResponseSchema,
      options,
    );
  }

  public async unsubscribeTask(
    projectId: string,
    taskId: string,
  ): Promise<UnsubscribeAgentTaskResponse> {
    return this.request(
      `${taskPath(projectId, taskId)}/unsubscribe`,
      UnsubscribeAgentTaskResponseSchema,
      { body: "{}", headers: { "content-type": "application/json" }, method: "POST" },
    );
  }

  public async startReview(
    projectId: string,
    taskId: string,
    input: ReviewAgentTaskRequest,
    options: MutationOptions = {},
  ): Promise<ReviewAgentTaskResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/review`,
      input,
      ReviewAgentTaskResponseSchema,
      options,
    );
  }

  public async compactTask(
    projectId: string,
    taskId: string,
    options: MutationOptions = {},
  ): Promise<CompactAgentTaskResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/compact`,
      {},
      CompactAgentTaskResponseSchema,
      options,
    );
  }

  public async forkTask(
    projectId: string,
    taskId: string,
    input: ForkAgentTaskRequest,
    options: MutationOptions = {},
  ): Promise<ForkAgentTaskResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/fork`,
      input,
      ForkAgentTaskResponseSchema,
      options,
    );
  }

  public async uploadFeedback(
    projectId: string,
    taskId: string,
    input: UploadAgentFeedbackRequest,
    options: MutationOptions = {},
  ): Promise<UploadAgentFeedbackResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/feedback`,
      input,
      UploadAgentFeedbackResponseSchema,
      options,
    );
  }

  public async uploadAttachment(
    projectId: string,
    input: AgentAttachmentUploadInput,
    options: MutationOptions = {},
  ): Promise<AgentAttachmentUploadResponse> {
    const body = new FormData();
    body.set("attachment", input.content, input.name);
    return this.request(
      `${projectPath(projectId)}/attachments/${input.kind}`,
      AgentAttachmentUploadResponseSchema,
      {
        body,
        headers: {
          "idempotency-key": options.idempotencyKey ?? createUuid(),
        },
        method: "POST",
      },
      AgentMutationErrorSchema,
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs: this.requestTimeouts.mutationMs,
      },
    );
  }

  public async importHostAttachment(
    projectId: string,
    kind: HostFileKind,
    path: string,
    options: MutationOptions = {},
  ): Promise<AgentAttachmentUploadResponse> {
    return this.mutation(
      `${projectPath(projectId)}/attachments/${kind}/host`,
      { path },
      AgentAttachmentUploadResponseSchema,
      options,
    );
  }

  public async startTurn(
    projectId: string,
    taskId: string,
    input: AgentPromptInput,
    turnOptions: AgentTurnOptions,
    options: MutationOptions = {},
  ): Promise<StartAgentTurnResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/turns`,
      { input, options: turnOptions },
      StartAgentTurnResponseSchema,
      options,
    );
  }

  public async steerTurn(
    projectId: string,
    taskId: string,
    turnId: string,
    input: AgentPromptInput,
    options: MutationOptions = {},
  ): Promise<SteerAgentTurnResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/turns/${encodeURIComponent(turnId)}/steer`,
      { input, taskId },
      SteerAgentTurnResponseSchema,
      options,
    );
  }

  public async interruptTurn(
    projectId: string,
    taskId: string,
    turnId: string,
    options: MutationOptions = {},
  ): Promise<InterruptAgentTurnResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      { taskId },
      InterruptAgentTurnResponseSchema,
      options,
    );
  }

  public async resolvePendingRequest<T extends PendingRequest>(
    request: T,
    resolution: PendingRequestResolution<T>,
    options: MutationOptions = {},
  ): Promise<ResolvePendingRequestResponse> {
    const body = {
      itemId: request.itemId,
      projectId: request.projectId,
      resolution,
      taskId: request.taskId,
      turnId: request.turnId,
      type: request.type,
    } as ResolvePendingRequestRequest;
    return this.mutation(
      `${taskPath(request.projectId, request.taskId)}/pending-requests/${encodeURIComponent(request.requestId)}/resolve`,
      body,
      ResolvePendingRequestResponseSchema,
      options,
    );
  }
}
