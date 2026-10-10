import type { ProjectGitStatus } from "@codexly/protocol";
import { isRootGitProject } from "@codexly/frontend-core/project-git-availability";
import type { QueryClient } from "@tanstack/react-query";

import { recordInternalWarning } from "../notifications/internal-diagnostics.js";
import { type CodexlyGitStatusClient, projectGitStatusQueryOptions } from "./project-queries.js";

export const PROJECT_GIT_STATUS_POLL_INTERVAL_MS = 300_000;
export const PROJECT_GIT_STATUS_WORKTREE_POLL_INTERVAL_MS = 10_000;
export const PROJECT_GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS = 300;
export const PROJECT_GIT_STATUS_RETRY_BASE_MS = 1_000;
export const PROJECT_GIT_STATUS_RETRY_MAX_MS = 30_000;

export type ProjectGitActivityReason = "file_changed" | "turn_completed" | "turn_started";

interface ProjectGitStatusCoordinatorOptions {
  readonly fileChangeDebounceMs?: number;
  readonly isPageVisible?: () => boolean;
  readonly pollIntervalMs?: number;
  readonly random?: () => number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
}

interface ProjectPollingState {
  activeTaskIds: Set<string>;
  closed: boolean;
  consecutiveFailures: number;
  fileChangeTimer: ReturnType<typeof setTimeout> | undefined;
  inFlight: Promise<void> | undefined;
  isGitProject: boolean | undefined;
  observers: Set<Readonly<{ worktree: boolean }>>;
  pollingIntervalMs: number | undefined;
  pollingTimer: ReturnType<typeof setInterval> | undefined;
  projectId: string;
  rootPath: string;
  refreshPending: "background" | "manual" | undefined;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
}

function defaultPageVisibility(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export class ProjectGitStatusCoordinator {
  readonly #client: CodexlyGitStatusClient;
  readonly #fileChangeDebounceMs: number;
  readonly #isPageVisible: () => boolean;
  readonly #pollIntervalMs: number;
  readonly #projects = new Map<string, ProjectPollingState>();
  readonly #queryClient: QueryClient;
  readonly #random: () => number;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  #disposeWindowFocus: (() => void) | undefined;
  #disposed = false;

  public constructor(
    queryClient: QueryClient,
    client: CodexlyGitStatusClient,
    options: ProjectGitStatusCoordinatorOptions = {},
  ) {
    this.#queryClient = queryClient;
    this.#client = client;
    this.#fileChangeDebounceMs =
      options.fileChangeDebounceMs ?? PROJECT_GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS;
    this.#isPageVisible = options.isPageVisible ?? defaultPageVisibility;
    this.#pollIntervalMs = options.pollIntervalMs ?? PROJECT_GIT_STATUS_POLL_INTERVAL_MS;
    this.#random = options.random ?? Math.random;
    this.#retryBaseMs = options.retryBaseMs ?? PROJECT_GIT_STATUS_RETRY_BASE_MS;
    this.#retryMaxMs = options.retryMaxMs ?? PROJECT_GIT_STATUS_RETRY_MAX_MS;
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#disposeWindowFocus?.();
    for (const state of this.#projects.values()) {
      this.#closeState(state);
    }
    this.#projects.clear();
  }

  public forgetProject(projectId: string): void {
    for (const [key, state] of this.#projects) {
      if (state.projectId !== projectId) continue;
      this.#closeState(state);
      this.#projects.delete(key);
    }
  }

  public subscribeWindowFocus(
    target: Pick<Window, "addEventListener" | "removeEventListener"> | undefined = typeof window ===
    "undefined"
      ? undefined
      : window,
  ): () => void {
    this.#disposeWindowFocus?.();
    if (this.#disposed || target === undefined) return () => undefined;
    const onFocus = () => {
      if (!this.#isPageVisible()) return;
      // Provider 只安装一个焦点监听；同根目录无论挂载多少分屏都只刷新一次。
      for (const state of this.#projects.values()) {
        if (state.observers.size > 0) {
          this.refreshObservedProject(state.projectId, state.rootPath);
        }
      }
    };
    target.addEventListener("focus", onFocus);
    let subscribed = true;
    const cleanup = () => {
      if (!subscribed) return;
      subscribed = false;
      target.removeEventListener("focus", onFocus);
    };
    this.#disposeWindowFocus = cleanup;
    return cleanup;
  }

  public observeProject(projectId: string, rootPath: string, worktree: boolean): () => void {
    if (this.#disposed) return () => undefined;
    const state = this.#getOrCreateState(projectId, rootPath);
    // 每个观察者使用独立身份，关闭任意一个分屏不会释放其他分屏的轮询需求。
    const observer = { worktree };
    state.observers.add(observer);
    this.#ensurePolling(state);
    return () => {
      state.observers.delete(observer);
      this.#ensurePolling(state);
      this.#releaseIdleState(state);
    };
  }

  public refreshObservedProject(projectId: string, rootPath: string): void {
    if (this.#disposed) return;
    const state = this.#projects.get(this.#stateKey(projectId, rootPath));
    if (state === undefined || state.observers.size === 0) return;
    const status = this.#queryClient.getQueryData<ProjectGitStatus>([
      "projects",
      projectId,
      rootPath,
      "git-status",
    ]);
    if (!isRootGitProject(status)) return;
    this.#requestBackgroundRefresh(state, "passive");
  }

  public handleActivity(
    projectId: string,
    rootPath: string,
    taskId: string,
    reason: ProjectGitActivityReason,
  ): void {
    if (this.#disposed) {
      return;
    }
    const state = this.#getOrCreateState(projectId, rootPath);
    if (reason === "turn_started") {
      const wasInactive = state.activeTaskIds.size === 0;
      const wasRecovering = state.consecutiveFailures > 0 || state.retryTimer !== undefined;
      state.activeTaskIds.add(taskId);
      if (state.isGitProject === false) {
        return;
      }
      if (wasInactive || wasRecovering) {
        this.#clearRetryTimer(state);
        this.#requestBackgroundRefresh(state);
      } else {
        this.#ensurePolling(state);
      }
      return;
    }

    if (reason === "file_changed") {
      state.activeTaskIds.add(taskId);
      this.#clearRetryTimer(state);
      if (state.isGitProject === false) {
        return;
      }
      this.#scheduleFileChangeRefresh(state);
      return;
    }

    state.activeTaskIds.delete(taskId);
    this.#clearFileChangeTimer(state);
    this.#clearRetryTimer(state);
    if (state.activeTaskIds.size === 0) {
      this.#clearPollingTimer(state);
    }
    if (state.isGitProject === false) {
      if (state.activeTaskIds.size === 0 && state.observers.size === 0) {
        this.#projects.delete(this.#stateKey(state.projectId, state.rootPath));
      }
      return;
    }
    // Turn 终态始终补读一次；最后一个 Task 的状态只在该请求完成后释放。
    this.#requestBackgroundRefresh(state);
  }

  public handleGitMetadataChanged(projectId: string, rootPath: string): void {
    if (this.#disposed) {
      return;
    }
    const state = this.#getOrCreateState(projectId, rootPath);
    if (state.isGitProject === false) return;
    this.#clearRetryTimer(state);
    // 原生 Watch 已完成粗粒度合并，这里再合并同一轮多个元数据文件通知。
    this.#scheduleFileChangeRefresh(state);
  }

  public async refreshProject(projectId: string, rootPath: string): Promise<void> {
    if (this.#disposed) {
      return;
    }
    const state = this.#getOrCreateState(projectId, rootPath);
    this.#clearRetryTimer(state);
    await this.#requestRefresh(state, "manual");
  }

  #clearFileChangeTimer(state: ProjectPollingState): void {
    if (state.fileChangeTimer !== undefined) {
      clearTimeout(state.fileChangeTimer);
      state.fileChangeTimer = undefined;
    }
  }

  #clearPollingTimer(state: ProjectPollingState): void {
    if (state.pollingTimer !== undefined) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = undefined;
    }
    state.pollingIntervalMs = undefined;
  }

  #clearRetryTimer(state: ProjectPollingState): void {
    if (state.retryTimer !== undefined) {
      clearTimeout(state.retryTimer);
      state.retryTimer = undefined;
    }
  }

  #closeState(state: ProjectPollingState): void {
    state.closed = true;
    state.refreshPending = undefined;
    this.#clearFileChangeTimer(state);
    this.#clearPollingTimer(state);
    this.#clearRetryTimer(state);
  }

  #ensurePolling(state: ProjectPollingState): void {
    const hasWorktreeObserver = [...state.observers].some((observer) => observer.worktree);
    const intervalMs = hasWorktreeObserver
      ? PROJECT_GIT_STATUS_WORKTREE_POLL_INTERVAL_MS
      : state.activeTaskIds.size > 0
        ? this.#pollIntervalMs
        : undefined;
    if (
      state.closed ||
      state.isGitProject !== true ||
      state.consecutiveFailures > 0 ||
      intervalMs === undefined ||
      state.retryTimer !== undefined
    ) {
      this.#clearPollingTimer(state);
      return;
    }
    if (state.pollingIntervalMs === intervalMs) return;
    // worktree 的短周期与任务兜底轮询共享一个计时器，取当前需求中的最短周期。
    this.#clearPollingTimer(state);
    state.pollingIntervalMs = intervalMs;
    state.pollingTimer = setInterval(() => {
      if (this.#isPageVisible()) {
        this.#requestBackgroundRefresh(state, "passive");
      }
    }, intervalMs);
  }

  #releaseIdleState(state: ProjectPollingState): void {
    const key = this.#stateKey(state.projectId, state.rootPath);
    if (
      this.#projects.get(key) === state &&
      state.activeTaskIds.size === 0 &&
      state.observers.size === 0 &&
      state.inFlight === undefined &&
      state.fileChangeTimer === undefined
    ) {
      this.#closeState(state);
      this.#projects.delete(key);
    }
  }

  #getOrCreateState(projectId: string, rootPath: string): ProjectPollingState {
    const key = this.#stateKey(projectId, rootPath);
    const current = this.#projects.get(key);
    if (current !== undefined) {
      return current;
    }
    const cachedStatus = this.#queryClient.getQueryData<ProjectGitStatus>([
      "projects",
      projectId,
      rootPath,
      "git-status",
    ]);
    const state: ProjectPollingState = {
      activeTaskIds: new Set(),
      closed: false,
      consecutiveFailures: 0,
      fileChangeTimer: undefined,
      inFlight: undefined,
      // 已确认非 Git 的项目复用检测结果，任务切换不能重新启动后台刷新。
      isGitProject: cachedStatus === undefined ? undefined : isRootGitProject(cachedStatus),
      observers: new Set(),
      pollingIntervalMs: undefined,
      pollingTimer: undefined,
      projectId,
      rootPath,
      refreshPending: undefined,
      retryTimer: undefined,
    };
    this.#projects.set(key, state);
    return state;
  }

  #stateKey(projectId: string, rootPath: string): string {
    return `${projectId}\u0000${rootPath}`;
  }

  #requestRefresh(
    state: ProjectPollingState,
    source: "background" | "manual" | "passive",
  ): Promise<void> {
    if (state.closed || this.#disposed) {
      return Promise.resolve();
    }
    if (state.inFlight !== undefined) {
      // 焦点、路由和轮询只复用在途读取；仓库变更与手动操作才需要排队补读。
      if (source === "passive") return state.inFlight;
      // 手动请求优先级更高，必须在当前读取结束后再次执行真实仓库探测。
      state.refreshPending =
        source === "manual" || state.refreshPending === "manual" ? "manual" : "background";
      return state.inFlight;
    }

    const queryOptions = projectGitStatusQueryOptions(
      state.projectId,
      state.rootPath,
      this.#client,
    );
    const refresh = this.#queryClient
      // 与初次挂载、Query 自身的可见性刷新共用在途请求，不取消后重新发送。
      .fetchQuery({ ...queryOptions, retry: false, staleTime: 0 })
      .then((status) => {
        state.consecutiveFailures = 0;
        state.isGitProject = isRootGitProject(status);
        if (!state.isGitProject) {
          this.#clearFileChangeTimer(state);
          this.#clearPollingTimer(state);
          this.#clearRetryTimer(state);
        }
      })
      .catch((error: unknown) => {
        state.consecutiveFailures += 1;
        this.#clearPollingTimer(state);
        throw error;
      })
      .finally(() => {
        if (state.closed || this.#disposed) {
          return;
        }
        state.inFlight = undefined;
        const pendingSource = state.refreshPending;
        state.refreshPending = undefined;
        if (
          pendingSource !== undefined &&
          (pendingSource === "manual" || state.isGitProject !== false)
        ) {
          this.#requestBackgroundRefresh(state, pendingSource);
          return;
        }
        if (state.activeTaskIds.size > 0 || state.observers.size > 0) {
          if (state.consecutiveFailures > 0) {
            if (state.isGitProject !== false) {
              this.#scheduleRetry(state);
            }
          } else {
            this.#ensurePolling(state);
          }
          return;
        }
        this.#releaseIdleState(state);
      });
    state.inFlight = refresh;
    return refresh;
  }

  #requestBackgroundRefresh(
    state: ProjectPollingState,
    source: "background" | "manual" | "passive" = "background",
  ): void {
    void this.#requestRefresh(state, source).catch((error: unknown) => {
      recordInternalWarning("git_status_poll_failed", error, {
        projectId: state.projectId,
        rootPath: state.rootPath,
      });
    });
  }

  #scheduleFileChangeRefresh(state: ProjectPollingState): void {
    this.#clearFileChangeTimer(state);
    state.fileChangeTimer = setTimeout(() => {
      state.fileChangeTimer = undefined;
      this.#requestBackgroundRefresh(state);
    }, this.#fileChangeDebounceMs);
  }

  #scheduleRetry(state: ProjectPollingState): void {
    if (
      state.closed ||
      state.isGitProject === false ||
      (state.activeTaskIds.size === 0 &&
        ![...state.observers].some((observer) => observer.worktree)) ||
      state.retryTimer !== undefined
    ) {
      return;
    }
    // 指数退避加入正负 20% 抖动，并保证最终延迟不超过上限。
    const exponentialDelay = Math.min(
      this.#retryMaxMs,
      this.#retryBaseMs * 2 ** Math.min(state.consecutiveFailures - 1, 30),
    );
    const jitteredDelay = Math.min(
      this.#retryMaxMs,
      Math.round(exponentialDelay * (0.8 + this.#random() * 0.4)),
    );
    state.retryTimer = setTimeout(() => {
      state.retryTimer = undefined;
      if (this.#isPageVisible()) {
        this.#requestBackgroundRefresh(state);
      } else {
        this.#scheduleRetry(state);
      }
    }, jitteredDelay);
  }
}
