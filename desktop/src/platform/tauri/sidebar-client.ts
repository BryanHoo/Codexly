import type { TaskSearchInput } from "@/protocol/global-search.js";
import {
  type ListCompletedTasksOptions,
  type ListTasksOptions,
  type ListFilesystemEntriesOptions,
  type PendingRequestResolution,
  type ReadTaskOptions,
  type ReadOptions,
  type MutationOptions,
  type SubscribeAgentEventsOptions,
} from "@/platform/native-client-types.js";
import type {
  AddAgentQueuedSubmissionResponse,
  AddProjectResponse,
  AgentBackgroundTerminalPage,
  AgentPromptInput,
  AgentQueuedSubmissionSnapshot,
  AgentTaskSnapshotResponse,
  AgentTaskPage,
  AgentTaskSettings,
  AgentTaskSettingsResponse,
  AgentTurnOptions,
  ArchiveAgentTaskResponse,
  CompactAgentTaskResponse,
  ClearAgentGoalResponse,
  DeleteAgentTaskResponse,
  DeleteAgentQueuedSubmissionResponse,
  DeleteScheduledTaskResponse,
  ForkAgentTaskRequest,
  ForkAgentTaskResponse,
  InterruptAgentTurnResponse,
  PinAgentTaskResponse,
  PendingRequest,
  ProjectDirectoryListing,
  ProjectPage,
  RemoveProjectResponse,
  ResolvePendingRequestResponse,
  RenameAgentTaskResponse,
  RenameProjectResponse,
  ReorderProjectsResponse,
  MoveAgentQueuedSubmissionResponse,
  StartAgentTaskResponse,
  StartAgentTurnResponse,
  StartAgentQueuedSubmissionResponse,
  SteerAgentTurnResponse,
  ScheduledTaskInput,
  ScheduledTaskMutationResponse,
  ScheduledTaskPage,
  ScheduledTaskSchedule,
  ScheduledTaskPreview,
  TerminateAgentBackgroundTerminalResponse,
  UnarchiveAgentTaskResponse,
  UpdateAgentGoalRequest,
  UpdateAgentGoalResponse,
} from "@/protocol/index.js";

import type { TauriClientOptions } from "./native-client.js";
import type { PendingResolutionReference } from "@/protocol/pending-request.js";
import { subscribeProjectEvents } from "./project-event-subscription.js";
import { TauriRuntimeClient } from "./runtime-client.js";
import type { SubmitPromptOptions } from "./prompt-submission.js";
import type { SubmitReviewOptions } from "./review-submission.js";

export type { InvokeImplementation } from "./native-client.js";

export class TauriSidebarClient extends TauriRuntimeClient {
  public async submitPrompt(options: SubmitPromptOptions) {
    // 提交专用校验按需加载，避免增加工作台首次渲染的协议代码。
    const { submitPrompt } = await import("./prompt-submission.js");
    return submitPrompt(this.call.bind(this), { ...options, onTaskCreated: (task) => {
      this.taskProjects.set(task.id, options.projectId);
      options.onTaskCreated?.(task);
    } });
  }

  public constructor(options: TauriClientOptions = {}) {
    super(options);
  }

  public async searchTasks(input: TaskSearchInput, options: ReadOptions = {}) {
    const response = await this.callCancellable<unknown>("search_tasks", { input }, options.signal);
    const { parseTaskSearchPage } = await import("./search-response.js");
    return parseTaskSearchPage(response);
  }

  public async searchTaskOccurrences(taskId: string, query: string, cursor?: string, options: ReadOptions = {}) {
    const response = await this.callCancellable<unknown>("search_task_occurrences", { taskId, query, cursor }, options.signal);
    const { parseSearchOccurrencesPage } = await import("./search-response.js");
    return parseSearchOccurrencesPage(response);
  }

  public async listProjects(_options: ReadOptions = {}): Promise<ProjectPage> {
    return this.call("list_projects");
  }

  public async listScheduledTasks(): Promise<ScheduledTaskPage> {
    return this.invokeCommand("list_scheduled_tasks");
  }

  public async previewScheduledTask(schedule: ScheduledTaskSchedule): Promise<ScheduledTaskPreview> {
    // Schema 校验按需加载，预览能力不增加工作台首屏的协议检查开销。
    const { parseScheduledTaskPreview } = await import("./scheduled-task-response.js");
    const result = await this.invokeCommand<unknown>("preview_scheduled_task", { schedule });
    return parseScheduledTaskPreview(result);
  }

  public async createScheduledTask(
    input: ScheduledTaskInput,
  ): Promise<ScheduledTaskMutationResponse> {
    return this.invokeCommand("create_scheduled_task", { input });
  }

  public async updateScheduledTask(
    taskId: string,
    input: ScheduledTaskInput,
  ): Promise<ScheduledTaskMutationResponse> {
    return this.invokeCommand("update_scheduled_task", { input, taskId });
  }

  public async deleteScheduledTask(taskId: string): Promise<DeleteScheduledTaskResponse> {
    return this.invokeCommand("delete_scheduled_task", { taskId });
  }

  public async setScheduledTaskEnabled(
    taskId: string,
    enabled: boolean,
  ): Promise<ScheduledTaskMutationResponse> {
    return this.invokeCommand("set_scheduled_task_enabled", { enabled, taskId });
  }

  public async runScheduledTaskNow(taskId: string): Promise<ScheduledTaskMutationResponse> {
    return this.invokeCommand("run_scheduled_task_now", { taskId });
  }

  public async listTasks(
    projectId: string,
    options: ListTasksOptions = {},
    requestOptions: ReadOptions = {},
  ): Promise<AgentTaskPage> {
    const response = await this.callCancellable<AgentTaskPage>("list_tasks", {
      input: {
        ...(options.archived === true ? { archived: true } : {}),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.pinned === true ? { pinned: true } : {}),
        projectId,
        ...(options.searchTerm === undefined ? {} : { searchTerm: options.searchTerm }),
      },
    }, requestOptions.signal);
    for (const task of response.data) this.taskProjects.set(task.id, projectId);
    return response;
  }

  public async listCompletedTasks(
    options: ListCompletedTasksOptions = {},
    requestOptions: ReadOptions = {},
  ): Promise<AgentTaskPage> {
    return this.callCancellable<AgentTaskPage>(
      "list_completed_tasks",
      {
        input: {
          ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
          ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
        },
      },
      requestOptions.signal,
    );
  }

  public async addProject(
    rootPaths: readonly string[],
    _options: MutationOptions = {},
  ): Promise<AddProjectResponse> {
    return this.call("add_project", { rootPaths: [...rootPaths] });
  }

  public async listProjectDirectories(
    path?: string,
    options: ListFilesystemEntriesOptions = {},
  ): Promise<ProjectDirectoryListing> {
    return this.callCancellable(
      "list_project_directories",
      {
        includeHidden: options.includeHidden === true,
        path: path ?? null,
      },
      options.signal,
    );
  }

  public async renameProject(
    projectId: string,
    name: string,
  ): Promise<RenameProjectResponse> {
    return this.call("rename_project", { name, projectId });
  }

  public async removeProject(projectId: string): Promise<RemoveProjectResponse> {
    return this.call("remove_project", { projectId });
  }

  public async reorderProjects(
    projectIds: readonly string[],
  ): Promise<ReorderProjectsResponse> {
    return this.call("reorder_projects", { projectIds: [...projectIds] });
  }

  public async pinTask(
    projectId: string,
    taskId: string,
    pinned: boolean,
  ): Promise<PinAgentTaskResponse> {
    return this.call("pin_task", { pinned, projectId, taskId });
  }

  public async renameTask(
    projectId: string,
    taskId: string,
    title: string,
  ): Promise<RenameAgentTaskResponse> {
    return this.call("rename_task", { projectId, taskId, title });
  }

  public async archiveTask(
    projectId: string,
    taskId: string,
  ): Promise<ArchiveAgentTaskResponse> {
    return this.call("archive_task", { projectId, taskId });
  }

  public async unarchiveTask(
    projectId: string,
    taskId: string,
  ): Promise<UnarchiveAgentTaskResponse> {
    return this.call("unarchive_task", { projectId, taskId });
  }

  public async deleteTask(
    projectId: string,
    taskId: string,
  ): Promise<DeleteAgentTaskResponse> {
    return this.call("delete_task", { projectId, taskId });
  }

  public async readTask(
    projectId: string,
    taskId: string,
    options: ReadTaskOptions = {},
  ): Promise<AgentTaskSnapshotResponse> {
    const response = await this.callCancellable<AgentTaskSnapshotResponse>(
      "read_task",
      {
        projectId,
        taskId,
        cursor: options.cursor ?? null,
      },
      options.signal,
    );
    this.taskProjects.set(response.snapshot.id, projectId);
    return response;
  }

  public async startTask(
    projectId: string,
    options: Readonly<{ idempotencyKey: string }>,
  ): Promise<StartAgentTaskResponse> {
    const response = await this.call<StartAgentTaskResponse>("start_task", { projectId, idempotencyKey: options.idempotencyKey });
    this.taskProjects.set(response.task.id, projectId);
    return response;
  }

  public async listQueuedSubmissions(
    projectId: string,
    taskId: string,
    _options: ReadOptions = {},
  ): Promise<AgentQueuedSubmissionSnapshot> {
    return this.call("list_queued_submissions", {
      projectId,
      taskId,
    });
  }

  public async addQueuedSubmission(
    projectId: string,
    taskId: string,
    input: AgentPromptInput,
    clientUserMessageId: string,
    options: Readonly<{ idempotencyKey: string }>,
  ): Promise<AddAgentQueuedSubmissionResponse> {
    return this.call("add_queued_submission", {
      idempotencyKey: options.idempotencyKey,
      clientUserMessageId,
      input,
      projectId,
      taskId,
    });
  }

  public async deleteQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    _options: MutationOptions = {},
  ): Promise<DeleteAgentQueuedSubmissionResponse> {
    return this.call("delete_queued_submission", { projectId, queuedSubmissionId, taskId });
  }

  public async moveQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    offset: -1 | 1,
  ): Promise<MoveAgentQueuedSubmissionResponse> {
    return this.call("move_queued_submission", {
      projectId,
      queuedSubmissionId,
      offset,
      taskId,
    });
  }

  public async startQueuedSubmission(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string | undefined,
    options: Readonly<{ idempotencyKey: string }>,
  ): Promise<StartAgentQueuedSubmissionResponse> {
    return this.call("start_queued_submission", {
      idempotencyKey: options.idempotencyKey,
      projectId,
      queuedSubmissionId: queuedSubmissionId ?? null,
      taskId,
    });
  }

  public async startTurn(
    projectId: string,
    taskId: string,
    input: AgentPromptInput,
    options: AgentTurnOptions,
    mutationOptions: Readonly<{ idempotencyKey: string }>,
  ): Promise<StartAgentTurnResponse> {
    return this.call("start_turn", {
      idempotencyKey: mutationOptions.idempotencyKey,
      input,
      options,
      projectId,
      taskId,
    });
  }

  public async steerTurn(
    projectId: string,
    taskId: string,
    turnId: string,
    input: AgentPromptInput,
    options: Readonly<{ idempotencyKey: string; queuedSubmissionId?: string }>,
  ): Promise<SteerAgentTurnResponse> {
    return this.call("steer_turn", { idempotencyKey: options.idempotencyKey, input, projectId, taskId, turnId,
      ...(options.queuedSubmissionId === undefined ? {} : { queuedSubmissionId: options.queuedSubmissionId }),
    });
  }

  public async interruptTurn(
    _projectId: string,
    taskId: string,
    turnId: string,
    _options: MutationOptions = {},
  ): Promise<InterruptAgentTurnResponse> {
    return this.call("interrupt_turn", { taskId, turnId });
  }

  public async resolvePendingRequest<T extends PendingRequest>(
    request: T,
    resolution: PendingRequestResolution<T>,
    options: Readonly<{ idempotencyKey: string }>,
  ): Promise<ResolvePendingRequestResponse> {
    return this.call("resolve_pending_request", {
      request: {
        projectId: request.projectId, taskId: request.taskId, turnId: request.turnId,
        itemId: request.itemId, requestId: request.requestId, createdAt: request.createdAt,
      } satisfies PendingResolutionReference,
      idempotencyKey: options.idempotencyKey,
      resolution,
    });
  }

  public async submitReview(options: SubmitReviewOptions) {
    const { submitReview } = await import("./review-submission.js");
    return submitReview(this.call.bind(this), { ...options, onTaskCreated: (task) => {
      this.taskProjects.set(task.id, options.projectId);
      options.onTaskCreated?.(task);
    } });
  }

  public async getTaskSettings(
    projectId: string,
    taskId: string,
  ): Promise<AgentTaskSettingsResponse> {
    return this.call("get_task_settings", { projectId, taskId });
  }

  public async updateTaskSettings(
    projectId: string,
    taskId: string,
    settings: AgentTaskSettings,
    turnId?: string,
  ): Promise<AgentTaskSettingsResponse> {
    return this.call("update_task_settings", {
      projectId,
      settings,
      taskId,
      ...(turnId === undefined ? {} : { turnId }),
    });
  }

  public async updateTaskGoal(
    projectId: string,
    taskId: string,
    input: UpdateAgentGoalRequest,
  ): Promise<UpdateAgentGoalResponse> {
    return this.call("update_task_goal", { projectId, status: input.status, taskId });
  }

  public async clearTaskGoal(
    projectId: string,
    taskId: string,
  ): Promise<ClearAgentGoalResponse> {
    return this.call("clear_task_goal", { projectId, taskId });
  }

  public async listBackgroundTerminals(
    projectId: string,
    taskId: string,
    _options: ReadOptions = {},
  ): Promise<AgentBackgroundTerminalPage> {
    return this.call("list_background_terminals", { projectId, taskId });
  }

  public async terminateBackgroundTerminal(
    projectId: string,
    taskId: string,
    terminalId: string,
    _options: MutationOptions = {},
  ): Promise<TerminateAgentBackgroundTerminalResponse> {
    return this.call("terminate_background_terminal", { projectId, taskId, terminalId });
  }

  public async compactTask(
    projectId: string,
    taskId: string,
    _options: MutationOptions = {},
  ): Promise<CompactAgentTaskResponse> {
    return this.call("compact_task", { projectId, taskId });
  }

  public async forkTask(
    projectId: string,
    taskId: string,
    input: ForkAgentTaskRequest,
    _options: MutationOptions = {},
  ): Promise<ForkAgentTaskResponse> {
    const response = await this.call<ForkAgentTaskResponse>("fork_task", {
      lastTurnId: input.lastTurnId ?? null,
      projectId,
      taskId,
    });
    this.taskProjects.set(response.task.id, projectId);
    return response;
  }

  public async releaseTaskSubscription(
    projectId: string,
    taskId: string,
  ): Promise<void> {
    await this.call("release_task_subscription", { projectId, taskId });
  }

  public async retainTaskSubscription(projectId: string, taskId: string): Promise<void> {
    await this.call("retain_task_subscription", { projectId, taskId });
  }

  public subscribeEvents(options: SubscribeAgentEventsOptions): () => void {
    return subscribeProjectEvents(this.subscribeNativeEvents, this.taskProjects, options);
  }

}
