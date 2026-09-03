import type { AgentProvider, AgentProviderEvent } from "@codexly/core";
import type { AgentMessageAttachment } from "@codexly/protocol";
import type { RpcErrorPayload, RpcServerRequest } from "./jsonl-rpc-client.js";
import { SUPPORTED_CODEX_VERSION } from "./binary.js";
import {
  CodexProtocolMappingError,
  CODEX_THREAD_CONFIG,
  CODEX_NOTIFICATION_METHODS,
  type PendingCodexRequest,
  expectRecord,
  expectString,
  mapCodexNotification,
  mapCodexServerRequest,
  requestIdKey,
} from "./codex-protocol-mapping.js";

import { CodexAgentProviderTasks } from "./agent-provider-tasks.js";
import { assertProjectThread } from "./agent-provider-base.js";
import {
  warnDroppedCodexNotification,
  warnEventListenerFailure,
  warnServerRequestRejectionFailure,
} from "./agent-provider-diagnostics.js";
import {
  isCommentaryAgentMessage,
  isFinalAgentMessage,
  isReviewerFailureFallback,
  readNotificationItemType,
  readNotificationTurnId,
  readMcpServerStartupStatus,
  readReviewWorkerThread,
  readTaskId,
} from "./agent-provider-notifications.js";
import { mapCodexMessageImage, mapCodexMessageText } from "./agent-provider-message-attachments.js";
import { normalizedPathIdentity } from "./runtime-owner-registry.js";

export class CodexAgentProviderEvents extends CodexAgentProviderTasks {
  public publishProjectGitMetadataChanged(rootPath: string): boolean {
    const rootIdentity = normalizedPathIdentity(rootPath);
    const configuredRoot = this.project.runtimeWorkspaceRoots.find(
      (candidate) => normalizedPathIdentity(candidate) === rootIdentity,
    );
    if (configuredRoot === undefined) {
      return false;
    }
    this.routeEvent({
      payload: { rootPath: configuredRoot },
      taskId: this.project.id,
      type: "project.git_metadata_changed",
    });
    return true;
  }

  public receiveNotification(method: string, params: unknown): void {
    if (this.handleProjectStateNotification(method, params)) return;
    this.handleNotification(method, params);
  }

  public receiveServerRequest(request: RpcServerRequest): void {
    this.handleServerRequest(request);
  }

  protected handleNotification(method: string, params: unknown): void {
    if (method === "mcpServer/startupStatus/updated") {
      try {
        const update = readMcpServerStartupStatus(params);
        if (
          this.runtime.projectTaskIds.has(update.taskId) ||
          this.runtime.pendingTaskReads.has(update.taskId)
        ) {
          this.routeEvent({
            payload: { name: update.name, ...update.status },
            taskId: update.taskId,
            type: "mcp_server.status_updated",
          });
        }
      } catch {
        this.warnDroppedNotification("invalid_notification", method, params);
      }
      return;
    }
    if (method === "serverRequest/resolved") {
      this.handleServerRequestResolved(params);
      return;
    }
    if (method === "thread/started") {
      const reviewWorker = readReviewWorkerThread(params);
      if (
        reviewWorker !== undefined &&
        this.runtime.activeReviewTargets.has(reviewWorker.parentTaskId)
      ) {
        // review worker 是独立 Codex Thread，但在产品时间线中属于父 Task 的同一审查回合。
        this.runtime.reviewWorkerParentTaskIds.set(
          reviewWorker.workerTaskId,
          reviewWorker.parentTaskId,
        );
        this.runtime.reviewWorkerTaskIds.set(reviewWorker.parentTaskId, reviewWorker.workerTaskId);
        this.runtime.activeReviewWorkerTaskIds.add(reviewWorker.parentTaskId);
        void this.resumeReviewWorker(reviewWorker.workerTaskId);
      }
      return;
    }
    const nativeTaskId = readTaskId(params) ?? "";
    const taskId = this.runtime.reviewWorkerParentTaskIds.get(nativeTaskId) ?? nativeTaskId;
    const nativeTurnId = readNotificationTurnId(method, params);
    const activeReviewTarget = this.runtime.activeReviewTargets.get(taskId);
    if (
      activeReviewTarget !== undefined &&
      nativeTurnId !== undefined &&
      this.runtime.activeReviewTurnIds.get(taskId) === undefined &&
      (method === "turn/started" || readNotificationItemType(params) === "enteredReviewMode")
    ) {
      // 官方 review/start 的首个 Turn 是用户可见审查 Turn，后续 reviewer Turn 仅用于内部执行。
      this.runtime.activeReviewTurnIds.set(taskId, nativeTurnId);
    }
    const reviewTurnId = this.runtime.activeReviewTurnIds.get(taskId);
    const isReviewWorker =
      activeReviewTarget !== undefined &&
      reviewTurnId !== undefined &&
      nativeTurnId !== undefined &&
      (nativeTaskId !== taskId || nativeTurnId !== reviewTurnId);
    if (isReviewWorker && method === "turn/started") {
      this.runtime.activeReviewWorkerTaskIds.add(taskId);
      this.runtime.reviewWorkerTurnIds.set(taskId, nativeTurnId);
    }
    if (isReviewWorker && method === "turn/completed") {
      // 内部终态只负责资源清理；外层 review Turn 才是用户可见终态。
      this.runtime.reviewWorkerTurnIds.delete(taskId);
      this.removeQueuedRequestsForTurn(taskId, nativeTurnId);
      this.pendingLifecycle.expireTurn(taskId, nativeTurnId);
      return;
    }
    const reviewItemType = readNotificationItemType(params);
    if (
      isReviewWorker &&
      method === "item/completed" &&
      reviewItemType === "agentMessage" &&
      isFinalAgentMessage(params)
    ) {
      this.runtime.reviewWorkerOutputTaskIds.add(taskId);
    }
    if (isReviewWorker && reviewItemType === "userMessage") {
      // Codex 会为 reviewer 写入两条相同 Prompt，均不属于用户对话。
      return;
    }
    const hasReviewWorkerOutput = this.runtime.reviewWorkerOutputTaskIds.has(taskId);
    if (
      activeReviewTarget !== undefined &&
      reviewTurnId !== undefined &&
      nativeTurnId === reviewTurnId &&
      method.startsWith("item/") &&
      (reviewItemType === "userMessage" ||
        (reviewItemType === "agentMessage" && !isCommentaryAgentMessage(params)) ||
        (reviewItemType === "exitedReviewMode" &&
          (hasReviewWorkerOutput || isReviewerFailureFallback(params))))
    ) {
      // 外层仍会代理结构化活动，只过滤内部 Prompt 和已由 worker 交付的重复终态。
      return;
    }
    let event: AgentProviderEvent | undefined;
    try {
      event = mapCodexNotification(
        method,
        params,
        (taskId, part, imageIndex) => this.mapMessageImage(taskId, part, imageIndex),
        (taskId, input, textIndex) => this.mapMessageText(taskId, input, textIndex),
        activeReviewTarget,
        isReviewWorker ? reviewTurnId : undefined,
        isReviewWorker,
        hasReviewWorkerOutput && !isReviewWorker,
        isReviewWorker ? taskId : undefined,
      );
    } catch {
      // 单个原生通知字段漂移不能中断 JSONL Client 或后续关键事件。
      this.warnDroppedNotification("invalid_notification", method, params);
      return;
    }
    if (event === undefined) {
      if (!CODEX_NOTIFICATION_METHODS.has(method)) {
        this.warnDroppedNotification("unknown_notification", method, params);
      }
      return;
    }
    this.runtime.retainSnapshotEvent(event);
    if (event.type === "turn.started") {
      this.runtime.runningTaskIds.add(event.taskId);
    }
    if (event.type === "turn.completed") {
      this.runtime.runningTaskIds.delete(event.taskId);
      this.runtime.activeReviewTargets.delete(event.taskId);
      this.runtime.activeReviewTurnIds.delete(event.taskId);
      this.runtime.activeReviewWorkerTaskIds.delete(event.taskId);
      this.runtime.reviewWorkerOutputTaskIds.delete(event.taskId);
      const reviewWorkerTaskId = this.runtime.reviewWorkerTaskIds.get(event.taskId);
      if (reviewWorkerTaskId !== undefined) {
        this.runtime.reviewWorkerParentTaskIds.delete(reviewWorkerTaskId);
      }
      this.runtime.reviewWorkerTaskIds.delete(event.taskId);
      this.runtime.reviewWorkerTurnIds.delete(event.taskId);
      this.removeQueuedRequestsForTurn(event.taskId, event.turnId);
      this.pendingLifecycle.expireTurn(event.taskId, event.turnId);
    }
    this.routeEvent(event);
  }

  protected warnDroppedNotification(
    diagnosticCode: "invalid_notification" | "unknown_notification",
    method: string,
    params: unknown,
  ): void {
    warnDroppedCodexNotification(this.logger, this.project.id, diagnosticCode, method, params);
  }

  protected hasTaskLifecycleObligations(taskId: string): boolean {
    return this.runtime.hasLifecycleObligations(taskId, this.pendingLifecycle.hasForTask(taskId));
  }

  protected clearTaskRuntimeState(taskId: string): void {
    this.historicalAttachments.clearTask(taskId);
    this.pendingLifecycle.clearTask(taskId);
    this.runtime.clearTask(taskId);
  }

  protected handleServerRequest(serverRequest: RpcServerRequest): void {
    let entry: PendingCodexRequest | undefined;
    try {
      entry = mapCodexServerRequest(serverRequest, this.project);
    } catch {
      // 单个请求字段漂移不能破坏后续帧，也不能让 Codex 永久等待。
      this.rejectServerRequest(serverRequest, {
        code: -32602,
        data: { method: serverRequest.method },
        message: "Invalid params",
      });
      return;
    }
    if (entry === undefined) {
      this.rejectServerRequest(serverRequest, {
        code: -32601,
        data: { method: serverRequest.method },
        message: "Method not found",
      });
      return;
    }
    if (this.hasPendingRequest(entry.request.requestId)) {
      return;
    }
    if (!this.runtime.projectTaskIds.has(entry.request.taskId)) {
      if (this.runtime.pendingTaskReads.has(entry.request.taskId)) {
        const queued = this.runtime.pendingTaskServerRequests.get(entry.request.taskId) ?? [];
        queued.push(entry);
        this.runtime.pendingTaskServerRequests.set(entry.request.taskId, queued);
      }
      return;
    }
    this.activatePendingRequest(entry);
  }

  protected rejectServerRequest(serverRequest: RpcServerRequest, error: RpcErrorPayload): void {
    void this.client.rejectServerRequest(serverRequest.id, error).catch(() => {
      warnServerRequestRejectionFailure(this.logger, this.project.id, serverRequest);
    });
  }

  protected activatePendingRequest(entry: PendingCodexRequest): void {
    this.pendingLifecycle.activate(entry);
  }

  protected hasPendingRequest(requestId: string): boolean {
    if (this.pendingLifecycle.has(requestId)) {
      return true;
    }
    return [...this.runtime.pendingTaskServerRequests.values()].some((entries) =>
      entries.some((entry) => entry.request.requestId === requestId),
    );
  }

  protected promotePendingServerRequests(taskId: string): void {
    const entries = this.runtime.pendingTaskServerRequests.get(taskId) ?? [];
    this.runtime.pendingTaskServerRequests.delete(taskId);
    for (const entry of entries) {
      this.activatePendingRequest(entry);
    }
  }

  protected removeQueuedRequestsForTurn(taskId: string, turnId: string): void {
    const queued = this.runtime.pendingTaskServerRequests.get(taskId);
    if (queued === undefined) {
      return;
    }
    const remaining = queued.filter((entry) => entry.request.turnId !== turnId);
    if (remaining.length === 0) {
      this.runtime.pendingTaskServerRequests.delete(taskId);
      return;
    }
    this.runtime.pendingTaskServerRequests.set(taskId, remaining);
  }

  protected handleServerRequestResolved(value: unknown): void {
    let params: Record<string, unknown>;
    try {
      params = expectRecord(value, "Codex serverRequest/resolved params");
    } catch {
      return;
    }
    const providerRequestId = params["requestId"];
    if (
      typeof providerRequestId !== "string" &&
      !(typeof providerRequestId === "number" && Number.isFinite(providerRequestId))
    ) {
      return;
    }
    const taskId = params["threadId"];
    if (typeof taskId !== "string") {
      return;
    }
    const requestId = requestIdKey(providerRequestId);
    if (this.pendingLifecycle.handleResolved(requestId, taskId)) {
      return;
    }

    // 原生终态也要清理归属验证中的暂存项，但此时不能发布未验证事件。
    const queued = this.runtime.pendingTaskServerRequests.get(taskId);
    const queuedIndex = queued?.findIndex((candidate) => candidate.request.requestId === requestId);
    if (queued === undefined || queuedIndex === undefined || queuedIndex < 0) {
      return;
    }
    queued.splice(queuedIndex, 1);
    if (queued.length === 0) {
      this.runtime.pendingTaskServerRequests.delete(taskId);
    }
  }

  protected routeEvent(event: AgentProviderEvent): void {
    if (
      event.type === "skills.changed" ||
      event.type === "project.git_metadata_changed" ||
      this.runtime.projectTaskIds.has(event.taskId)
    ) {
      this.publishEvent(event);
      return;
    }
    if (this.runtime.pendingTaskReads.has(event.taskId)) {
      const pendingEvents = this.runtime.pendingTaskEvents.get(event.taskId) ?? [];
      pendingEvents.push(event);
      this.runtime.pendingTaskEvents.set(event.taskId, pendingEvents);
    }
  }

  protected finishTaskRead(taskId: string, projectOwnershipVerified: boolean): void {
    const remainingReads = (this.runtime.pendingTaskReads.get(taskId) ?? 1) - 1;
    if (projectOwnershipVerified) {
      // 归属确认后先同步交付读取期间的通知，再让 readTask Promise 完成。
      this.runtime.projectTaskIds.add(taskId);
      const pendingEvents = this.runtime.pendingTaskEvents.get(taskId) ?? [];
      this.runtime.pendingTaskEvents.delete(taskId);
      for (const event of pendingEvents) {
        this.publishEvent(event);
      }
    }
    if (remainingReads > 0) {
      this.runtime.pendingTaskReads.set(taskId, remainingReads);
      return;
    }
    this.runtime.pendingTaskReads.delete(taskId);
    if (!this.runtime.projectTaskIds.has(taskId)) {
      this.runtime.pendingTaskEvents.delete(taskId);
      this.runtime.pendingTaskServerRequests.delete(taskId);
      this.runtime.contextUsage.delete(taskId);
      this.pendingLifecycle.clearTask(taskId);
    }
  }

  protected publishEvent(event: AgentProviderEvent): void {
    // 内部订阅接收所有事件；普通订阅只接收用户可导航的持久 Task 事件。
    const notify = (listener: (event: AgentProviderEvent) => void): void => {
      try {
        listener(event);
      } catch {
        warnEventListenerFailure(this.logger, this.project.id, event);
      }
    };
    const isEphemeral = this.runtime.ephemeralTaskIds.has(event.taskId);
    if (!isEphemeral) {
      for (const listener of this.eventListeners) {
        notify(listener);
      }
    }
    for (const listener of this.eventListenersIncludingEphemeral) {
      if (isEphemeral || !this.eventListeners.has(listener)) {
        notify(listener);
      }
    }
  }

  protected mapMessageImage(
    taskId: string,
    part: Record<string, unknown>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    return mapCodexMessageImage(this.historicalAttachments, taskId, part, imageIndex);
  }

  protected mapMessageText(
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ): AgentMessageAttachment | undefined {
    return mapCodexMessageText(this.historicalAttachments, taskId, input, textIndex);
  }

  protected assertKnownProjectTask(taskId: string): void {
    if (!this.runtime.projectTaskIds.has(taskId)) {
      throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
    }
  }

  protected async resumeTask(taskId: string): Promise<void> {
    if (this.runtime.resumedTaskIds.has(taskId)) {
      return;
    }
    const currentResume = this.runtime.resumePromises.get(taskId);
    if (currentResume !== undefined) {
      return currentResume;
    }

    const resumePromise = (async () => {
      const response = expectRecord(
        await this.client.request("thread/resume", {
          config: CODEX_THREAD_CONFIG,
          // 恢复只负责加载运行时，Snapshot 历史继续通过分页接口获取。
          excludeTurns: true,
          // 恢复 Project Task 时覆盖旧运行时配置，使全部根立即生效。
          ...(this.project.kind === "project"
            ? { runtimeWorkspaceRoots: [...this.project.runtimeWorkspaceRoots] }
            : {}),
          threadId: taskId,
        }),
        "thread/resume response",
      );
      const thread = expectRecord(response["thread"], "thread/resume thread");
      if (expectString(thread["id"], "thread/resume thread id") !== taskId) {
        throw new CodexProtocolMappingError("thread/resume returned a different thread");
      }
      await assertProjectThread(thread, this.project);
      // 恢复成功后，本次 App Server 生命周期内可直接继续后续 Turn。
      this.runtime.resumedTaskIds.add(taskId);
    })();
    this.runtime.resumePromises.set(taskId, resumePromise);
    try {
      await resumePromise;
    } finally {
      if (this.runtime.resumePromises.get(taskId) === resumePromise) {
        this.runtime.resumePromises.delete(taskId);
      }
    }
  }

  protected async resumeReviewWorker(workerTaskId: string): Promise<void> {
    try {
      const response = expectRecord(
        await this.client.request("thread/resume", {
          config: CODEX_THREAD_CONFIG,
          threadId: workerTaskId,
        }),
        "review worker thread/resume response",
      );
      const thread = expectRecord(response["thread"], "review worker thread/resume thread");
      if (expectString(thread["id"], "review worker resumed thread id") !== workerTaskId) {
        throw new CodexProtocolMappingError(
          "review worker thread/resume returned a different thread",
        );
      }
    } catch {
      // Snapshot 会补偿订阅建立前的事件；恢复失败不能中断父 Task 的审查生命周期。
      this.logger.warn(
        {
          codexVersion: SUPPORTED_CODEX_VERSION,
          diagnosticCode: "review_worker_resume_failed",
          projectId: this.project.id,
          taskId: workerTaskId,
        },
        "Codex review worker resume failed",
      );
    }
  }
}

export class CodexAgentProvider extends CodexAgentProviderEvents implements AgentProvider {}
