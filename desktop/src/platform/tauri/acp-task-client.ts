import type {
  AcpConfigOption,
  AcpSessionState,
  AgentPromptInput,
  AgentMessageAttachment,
  AgentEngine,
  AgentTaskSnapshotResponse,
  AgentTurn,
  AgentTurnOptions,
  PendingRequest,
  ResolvePendingRequestRequest,
  AddAgentQueuedSubmissionResponse,
  AgentQueuedSubmissionList,
  AgentQueuedSubmissionStatus,
  UpdateAgentQueuedSubmissionResponse,
  ReorderAgentQueuedSubmissionsResponse,
  StartAgentQueuedSubmissionResponse,
  DeleteAgentQueuedSubmissionResponse,
} from "@codexly/protocol";
import type { MutationOptions, ReadOptions } from "@/platform/native-client-types.js";
import { TauriWorkspaceClient } from "./workspace-client.js";

/** ACP 原生快照保留真实 checkpoint；旧 settings 字段由后续配置 UI 迁移，不伪造默认值。 */
export type AcpNativeTaskSnapshot = Omit<AgentTaskSnapshotResponse, "snapshot"> & {
  snapshot: Omit<AgentTaskSnapshotResponse["snapshot"], "settings">;
};
export type AcpNativePromptInput = Omit<AgentPromptInput, "attachments"> & {
  attachments: readonly AgentMessageAttachment[];
};
export class TauriAcpTaskClient extends TauriWorkspaceClient {
  getAcpSessionState(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AcpSessionState> {
    this.taskProjects.set(taskId, projectId);
    return this.callCancellable(
      "acp_task_request",
      { projectId, method: "session.state.read", params: { taskId } },
      options.signal,
    );
  }
  async createAcpTask(
    projectId: string,
    engine: AgentEngine,
    options: MutationOptions & { idempotencyKey: string },
  ): Promise<
    Pick<
      AgentTaskSnapshotResponse["snapshot"],
      "engine" | "id" | "projectId" | "title" | "updatedAt" | "pinned" | "workspacePath"
    >
  > {
    options.signal?.throwIfAborted();
    // 同一创建意图的重试由调用方保留幂等键；发送后不因等待取消而重新创建。
    const idempotencyKey = options.idempotencyKey;
    return this.call("create_acp_task", { projectId, engine, idempotencyKey });
  }

  getAcpTask(
    projectId: string,
    taskId: string,
    options: ReadOptions & { cursor?: string } = {},
  ): Promise<AcpNativeTaskSnapshot> {
    // 先登记归属，再连接事件通道与读取快照，避免读取期间的首帧被项目过滤器丢弃。
    this.taskProjects.set(taskId, projectId);
    return this.callCancellable(
      "acp_task_request",
      {
        projectId,
        method: "task.read",
        params: { taskId, ...(options.cursor ? { cursor: options.cursor } : {}) },
      },
      options.signal,
    );
  }
  getAcpSessionConfig(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AcpConfigOption[]> {
    this.taskProjects.set(taskId, projectId);
    return this.callCancellable(
      "acp_task_request",
      { projectId, method: "session.config.read", params: { taskId } },
      options.signal,
    );
  }
  setAcpSessionConfig(
    projectId: string,
    taskId: string,
    configId: string,
    value: string | boolean,
    options: MutationOptions = {},
  ): Promise<AcpConfigOption[]> {
    return this.mutateAcpTask(
      projectId,
      "session.config.write",
      { taskId, configId, value },
      options,
    );
  }
  startAcpPrompt(
    projectId: string,
    taskId: string,
    input: AcpNativePromptInput,
    turnOptions: AgentTurnOptions,
    options: MutationOptions = {},
  ): Promise<AgentTurn> {
    return this.mutateAcpTask(
      projectId,
      "turn.start",
      { taskId, input, options: turnOptions },
      options,
    );
  }
  startAcpTurn(
    projectId: string,
    taskId: string,
    text: string,
    turnOptions: AgentTurnOptions,
    options: MutationOptions = {},
  ): Promise<AgentTurn> {
    return this.mutateAcpTask(
      projectId,
      "turn.start",
      { taskId, input: { text }, options: turnOptions },
      options,
    );
  }
  interruptAcpTurn(projectId: string, taskId: string, turnId: string): Promise<null> {
    return this.mutateAcpTask(projectId, "turn.interrupt", { taskId, turnId }, {});
  }
  resolveAcpRequest(
    projectId: string,
    requestId: string,
    input: ResolvePendingRequestRequest,
    options: MutationOptions = {},
  ): Promise<PendingRequest> {
    return this.mutateAcpTask(projectId, "request.resolve", { ...input, requestId }, options);
  }
  listAcpQueuedSubmissions(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AgentQueuedSubmissionList> {
    this.taskProjects.set(taskId, projectId);
    return this.callCancellable(
      "acp_task_request",
      { projectId, method: "queue.list", params: { taskId } },
      options.signal,
    );
  }
  addAcpQueuedSubmission(
    projectId: string,
    taskId: string,
    input: AcpNativePromptInput,
    clientUserMessageId: string,
    options: MutationOptions = {},
  ): Promise<AddAgentQueuedSubmissionResponse> {
    return this.mutateAcpTask(
      projectId,
      "queue.add",
      { taskId, input, clientUserMessageId },
      options,
    );
  }
  updateAcpQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    input: AcpNativePromptInput,
    status: AgentQueuedSubmissionStatus,
    options: MutationOptions = {},
  ): Promise<UpdateAgentQueuedSubmissionResponse> {
    return this.mutateAcpTask(
      projectId,
      "queue.update",
      { taskId, queuedSubmissionId, input, status },
      options,
    );
  }
  reorderAcpQueuedSubmissions(
    projectId: string,
    taskId: string,
    queuedSubmissionIds: readonly string[],
    options: MutationOptions = {},
  ): Promise<ReorderAgentQueuedSubmissionsResponse> {
    return this.mutateAcpTask(projectId, "queue.reorder", { taskId, queuedSubmissionIds }, options);
  }
  moveAcpQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    offset: -1 | 1,
    options: MutationOptions = {},
  ): Promise<{ moved: boolean; queue: AgentQueuedSubmissionList }> {
    return this.mutateAcpTask(
      projectId,
      "queue.move",
      { taskId, queuedSubmissionId, offset },
      options,
    );
  }
  startAcpQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId?: string,
    options: MutationOptions = {},
  ): Promise<StartAgentQueuedSubmissionResponse> {
    return this.mutateAcpTask(
      projectId,
      "queue.start",
      { taskId, ...(queuedSubmissionId === undefined ? {} : { queuedSubmissionId }) },
      options,
    );
  }
  deleteAcpQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    options: MutationOptions = {},
  ): Promise<DeleteAgentQueuedSubmissionResponse> {
    return this.mutateAcpTask(projectId, "queue.delete", { taskId, queuedSubmissionId }, options);
  }
  private async mutateAcpTask<T>(
    projectId: string,
    method: string,
    params: Record<string, unknown>,
    options: MutationOptions,
  ): Promise<T> {
    // 已发出的 prompt 不因等待取消而被自动重试；中断必须使用原任务与回合身份。
    options.signal?.throwIfAborted();
    if (typeof params["taskId"] === "string") this.taskProjects.set(params["taskId"], projectId);
    return this.call("acp_task_request", { projectId, method, params }, options.signal);
  }
}
