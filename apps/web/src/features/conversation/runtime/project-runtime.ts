import type { AgentTask, AgentTaskSnapshot, AgentTaskSnapshotResponse } from "@codexly/protocol";
import {
  createBrowserTaskNotifier,
  type TaskNotifier,
} from "../../notifications/browser-task-notifier.js";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";
import type { CodexlyRuntimeClient } from "../../projects/project-queries.js";
import {
  clearTaskAttention,
  getTaskActivity,
  recordRunningTaskActivity,
  recordTaskActivitySnapshot,
  reduceTaskActivityEvent,
  removeTaskActivity,
  type TaskActivityMap,
} from "./task-activity.js";
import type { TaskStore } from "./task-store.js";

import {
  MAX_PROJECT_EVENT_HISTORY_BYTES,
  MAX_PROJECT_EVENT_HISTORY_EVENTS,
  MAX_TASK_TITLES,
  PROJECT_RUNTIME_IDLE_TIMEOUT_MS,
  createProjectTaskKey,
  createProjectTurnKey,
  type ActivityListener,
  type ProjectRuntimeManagerOptions,
  type RecoverTaskSnapshot,
} from "./project-runtime-history.js";

import { ProjectEventRuntime } from "./project-runtime-events.js";

export class ProjectRuntimeManager {
  readonly #activityListeners = new Set<ActivityListener>();
  readonly #idleTimeoutMs: number;
  readonly #maxEventHistoryBytes: number;
  readonly #maxEventHistoryEvents: number;
  readonly #onMcpServerStatusChanged: NonNullable<
    ProjectRuntimeManagerOptions["onMcpServerStatusChanged"]
  >;
  readonly #onProjectGitActivity: NonNullable<ProjectRuntimeManagerOptions["onProjectGitActivity"]>;
  readonly #onProjectGitMetadataChanged: NonNullable<
    ProjectRuntimeManagerOptions["onProjectGitMetadataChanged"]
  >;
  readonly #onQueueChanged: NonNullable<ProjectRuntimeManagerOptions["onQueueChanged"]>;
  readonly #onSkillsChanged: NonNullable<ProjectRuntimeManagerOptions["onSkillsChanged"]>;
  readonly #onTaskRemoved: NonNullable<ProjectRuntimeManagerOptions["onTaskRemoved"]>;
  readonly #onTaskMetadataChanged: NonNullable<
    ProjectRuntimeManagerOptions["onTaskMetadataChanged"]
  >;
  readonly #projects = new Map<string, ProjectEventRuntime>();
  readonly #taskNotifier: TaskNotifier;
  #taskActivity: TaskActivityMap = new Map();
  readonly #taskTitles = new Map<string, string>();
  readonly #titleRefreshedRunningTurns = new Set<string>();
  #viewedTask: Readonly<{ projectId: string; taskId: string }> | undefined;

  public readonly client: CodexlyRuntimeClient;

  public constructor(client: CodexlyRuntimeClient, options: ProjectRuntimeManagerOptions = {}) {
    this.client = client;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? PROJECT_RUNTIME_IDLE_TIMEOUT_MS;
    this.#maxEventHistoryBytes = options.maxEventHistoryBytes ?? MAX_PROJECT_EVENT_HISTORY_BYTES;
    this.#maxEventHistoryEvents = options.maxEventHistoryEvents ?? MAX_PROJECT_EVENT_HISTORY_EVENTS;
    this.#onMcpServerStatusChanged = options.onMcpServerStatusChanged ?? (() => undefined);
    this.#onProjectGitActivity = options.onProjectGitActivity ?? (() => undefined);
    this.#onProjectGitMetadataChanged = options.onProjectGitMetadataChanged ?? (() => undefined);
    this.#onQueueChanged = options.onQueueChanged ?? (() => undefined);
    this.#onSkillsChanged = options.onSkillsChanged ?? (() => undefined);
    this.#onTaskRemoved = options.onTaskRemoved ?? (() => undefined);
    this.#onTaskMetadataChanged = options.onTaskMetadataChanged ?? (() => undefined);
    this.#taskNotifier = options.taskNotifier ?? createBrowserTaskNotifier();
    if (!Number.isSafeInteger(this.#idleTimeoutMs) || this.#idleTimeoutMs < 0) {
      throw new RangeError("Project Runtime idleTimeoutMs must be non-negative");
    }
    if (!Number.isSafeInteger(this.#maxEventHistoryBytes) || this.#maxEventHistoryBytes < 0) {
      throw new RangeError("Project Runtime maxEventHistoryBytes must be non-negative");
    }
    if (!Number.isSafeInteger(this.#maxEventHistoryEvents) || this.#maxEventHistoryEvents < 0) {
      throw new RangeError("Project Runtime maxEventHistoryEvents must be non-negative");
    }
  }

  public attachTaskStore(
    response: AgentTaskSnapshotResponse,
    store: TaskStore,
    recoverSnapshot: RecoverTaskSnapshot,
  ): () => void {
    this.#rememberTaskTitle(response.snapshot);
    this.#recordSnapshotActivity(response.snapshot);
    return this.#getProject(response.snapshot.projectId).attachTaskStore(
      response,
      store,
      recoverSnapshot,
    );
  }

  public dispose(): void {
    for (const project of this.#projects.values()) {
      project.dispose();
    }
    this.#projects.clear();
    this.#activityListeners.clear();
    this.#taskTitles.clear();
    this.#titleRefreshedRunningTurns.clear();
  }

  public forgetTask(projectId: string, taskId: string): void {
    this.#updateTaskActivity(removeTaskActivity(this.#taskActivity, projectId, taskId));
    this.#taskTitles.delete(createProjectTaskKey(projectId, taskId));
    this.#projects.get(projectId)?.forgetTask(taskId);
  }

  public forgetProject(projectId: string): void {
    const project = this.#projects.get(projectId);
    project?.dispose();
    this.#projects.delete(projectId);

    let nextActivity = this.#taskActivity;
    for (const record of this.#taskActivity.values()) {
      if (record.projectId === projectId) {
        nextActivity = removeTaskActivity(nextActivity, projectId, record.taskId);
      }
    }
    this.#updateTaskActivity(nextActivity);

    const projectKeyPrefix = `${projectId}\u0000`;
    for (const key of this.#taskTitles.keys()) {
      if (key.startsWith(projectKeyPrefix)) {
        this.#taskTitles.delete(key);
      }
    }
    for (const key of this.#titleRefreshedRunningTurns) {
      if (key.startsWith(projectKeyPrefix)) {
        this.#titleRefreshedRunningTurns.delete(key);
      }
    }
    if (this.#viewedTask?.projectId === projectId) {
      this.#viewedTask = undefined;
    }
  }

  public getTaskActivity(): TaskActivityMap {
    return this.#taskActivity;
  }

  public markTaskRunning(projectId: string, taskId: string): void {
    this.#updateTaskActivity(recordRunningTaskActivity(this.#taskActivity, projectId, taskId));
    this.#onProjectGitActivity(projectId, taskId, "turn_started");
    this.#projects.get(projectId)?.markAccess();
  }

  public observeSnapshot(response: AgentTaskSnapshotResponse): void {
    this.#rememberTaskTitle(response.snapshot);
    this.#recordSnapshotActivity(response.snapshot);
    this.#getProject(response.snapshot.projectId).observeSnapshot(response);
  }

  public requestNotificationPermission(): Promise<void> {
    return this.#taskNotifier.requestPermission().catch((error: unknown) => {
      recordInternalWarning("notification_permission_failed", error);
    });
  }

  public reconcileTaskSnapshot(response: AgentTaskSnapshotResponse): void {
    this.#rememberTaskTitle(response.snapshot);
    this.#recordSnapshotActivity(response.snapshot);
    this.#getProject(response.snapshot.projectId).reconcileTaskSnapshot(response);
  }

  public async refreshTaskSnapshot(
    projectId: string,
    taskId: string,
  ): Promise<AgentTaskSnapshotResponse> {
    const response = await this.client.readTask(projectId, taskId);
    this.reconcileTaskSnapshot(response);
    return response;
  }

  public rememberTaskTitles(tasks: readonly Pick<AgentTask, "id" | "projectId" | "title">[]): void {
    for (const task of tasks) {
      this.#rememberTaskTitle(task);
    }
  }

  public viewTask(projectId: string, taskId?: string): void {
    this.#viewedTask = taskId === undefined ? undefined : { projectId, taskId };
    if (taskId !== undefined) {
      this.#updateTaskActivity(clearTaskAttention(this.#taskActivity, projectId, taskId));
    }
    this.#projects.get(projectId)?.markAccess();
  }

  public subscribeTaskActivity(listener: ActivityListener): () => void {
    this.#activityListeners.add(listener);
    return () => {
      this.#activityListeners.delete(listener);
    };
  }

  #getProject(projectId: string): ProjectEventRuntime {
    let project = this.#projects.get(projectId);
    if (project !== undefined) {
      return project;
    }
    project = new ProjectEventRuntime(
      projectId,
      this.client,
      {
        getTaskActivity: () => this.#taskActivity,
        onActivityEvent: (eventProjectId, event) => {
          if (event.type === "project.git_metadata_changed") {
            // Project 级失效不进入 Task 通知和活动状态归约。
            this.#onProjectGitMetadataChanged(eventProjectId, event.payload.rootPath);
            return;
          }
          if (event.type === "skills.changed") {
            this.#onSkillsChanged(eventProjectId);
          } else if (event.type === "queue.changed") {
            this.#onQueueChanged(eventProjectId, event.taskId);
          } else if (event.type === "task.metadata_changed") {
            this.#onTaskMetadataChanged(eventProjectId, event.taskId, "native_notification");
          } else if (event.type === "task.removed") {
            this.#onTaskRemoved(eventProjectId, event.taskId);
            this.forgetTask(eventProjectId, event.taskId);
          } else if (event.type === "mcp_server.status_updated") {
            this.#onMcpServerStatusChanged(eventProjectId, event.taskId);
          } else if (event.type === "turn.started") {
            this.#onProjectGitActivity(eventProjectId, event.taskId, "turn_started");
          } else if (
            event.type === "item.completed" &&
            event.payload.item.type === "file_change" &&
            event.payload.item.status === "completed"
          ) {
            // 文件 Item 是高价值失效信号，避免等待下一个周期才更新 Inspector。
            this.#onProjectGitActivity(eventProjectId, event.taskId, "file_changed");
          }
          if (event.type === "message.delta") {
            const turnKey = createProjectTurnKey(eventProjectId, event.taskId, event.turnId);
            if (!this.#titleRefreshedRunningTurns.has(turnKey)) {
              // 首个 Assistant Delta 出现时刷新一次，避免流式 Token 持续触发 HTTP 请求。
              this.#titleRefreshedRunningTurns.add(turnKey);
              if (this.#titleRefreshedRunningTurns.size > MAX_TASK_TITLES) {
                const oldestTurnKey = this.#titleRefreshedRunningTurns.values().next().value;
                if (oldestTurnKey !== undefined) {
                  this.#titleRefreshedRunningTurns.delete(oldestTurnKey);
                }
              }
              this.#onTaskMetadataChanged(eventProjectId, event.taskId, "assistant_reply_started");
            }
          }
          if (event.type === "turn.completed") {
            const turnKey = createProjectTurnKey(eventProjectId, event.taskId, event.turnId);
            this.#titleRefreshedRunningTurns.delete(turnKey);
            this.#onProjectGitActivity(eventProjectId, event.taskId, "turn_completed");
            // 标题由 Provider 在 Turn 结束时生成，后台 Task 也必须通知列表读取最新元数据。
            this.#onTaskMetadataChanged(eventProjectId, event.taskId, "turn_completed");
          }
          try {
            this.#taskNotifier.notify(
              eventProjectId,
              event,
              this.#taskTitles.get(createProjectTaskKey(eventProjectId, event.taskId)) ?? "Task",
            );
          } catch (error) {
            recordInternalWarning("task_notification_failed", error, {
              projectId: eventProjectId,
              taskId: event.taskId,
            });
          }
          this.#updateTaskActivity(
            reduceTaskActivityEvent(
              this.#taskActivity,
              eventProjectId,
              event,
              this.#isTaskViewed(eventProjectId, event.taskId),
            ),
          );
        },
        onIdle: (idleProject) => {
          if (this.#projects.get(projectId) === idleProject) {
            this.#projects.delete(projectId);
          }
        },
        onSnapshot: (response) => {
          this.observeSnapshot(response);
        },
      },
      {
        idleTimeoutMs: this.#idleTimeoutMs,
        maxEventHistoryBytes: this.#maxEventHistoryBytes,
        maxEventHistoryEvents: this.#maxEventHistoryEvents,
      },
    );
    this.#projects.set(projectId, project);
    return project;
  }

  #updateTaskActivity(nextActivity: TaskActivityMap): void {
    if (nextActivity === this.#taskActivity) {
      return;
    }
    this.#taskActivity = nextActivity;
    for (const listener of this.#activityListeners) {
      listener();
    }
  }

  #isTaskViewed(projectId: string, taskId: string): boolean {
    return this.#viewedTask?.projectId === projectId && this.#viewedTask.taskId === taskId;
  }

  #recordSnapshotActivity(snapshot: AgentTaskSnapshot): void {
    const wasRunning = getTaskActivity(
      this.#taskActivity,
      snapshot.projectId,
      snapshot.id,
    ).isRunning;
    const isRunning = snapshot.status === "running";
    if (isRunning !== wasRunning) {
      this.#onProjectGitActivity(
        snapshot.projectId,
        snapshot.id,
        isRunning ? "turn_started" : "turn_completed",
      );
    }
    this.#updateTaskActivity(
      recordTaskActivitySnapshot(
        this.#taskActivity,
        snapshot,
        this.#isTaskViewed(snapshot.projectId, snapshot.id),
      ),
    );
  }

  #rememberTaskTitle(task: Pick<AgentTask, "id" | "projectId" | "title">): void {
    const key = createProjectTaskKey(task.projectId, task.id);
    this.#taskTitles.delete(key);
    this.#taskTitles.set(key, task.title);
    if (this.#taskTitles.size > MAX_TASK_TITLES) {
      const oldestKey = this.#taskTitles.keys().next().value;
      if (oldestKey !== undefined) {
        this.#taskTitles.delete(oldestKey);
      }
    }
  }
}

export function createProjectRuntimeManager(
  client: CodexlyRuntimeClient,
  options: ProjectRuntimeManagerOptions = {},
): ProjectRuntimeManager {
  return new ProjectRuntimeManager(client, options);
}

export * from "./project-runtime-history.js";
