import { estimateRetainedBytes, type AgentProvider, type AgentProviderEvent } from "@codexly/core";
import type { HistoricalAttachmentResult } from "./persistent-historical-attachment-store.js";
import { deliverNotificationAttachment } from "./notification-attachment-delivery.js";
import { resolveAttachmentMapping } from "./resolve-attachment-mapping.js";
import type { RpcErrorPayload, RpcServerRequest } from "./jsonl-rpc-client.js";
import {
  CodexProtocolMappingError,
  CODEX_NOTIFICATION_METHODS,
  type PendingCodexRequest,
  expectRecord,
  mapCodexNotification,
  mapCodexServerRequest,
  requestIdKey,
} from "./codex-protocol-mapping.js";

import { CodexAgentProviderTaskResume } from "./agent-provider-task-resume.js";
import {
  warnDroppedCodexNotification,
  warnNotificationQueueRecovery,
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
import { resumeReviewWorker } from "./review-worker-resume.js";

export class CodexAgentProviderEvents extends CodexAgentProviderTaskResume {
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
    const nativeTaskId = readTaskId(params) ?? "";
    const taskId = this.runtime.reviewWorkerParentTaskIds.get(nativeTaskId) ?? nativeTaskId;
    this.notificationQueue.run(
      taskId,
      (signal) => this.#receiveNotification(method, params, signal),
      () => {
        this.warnDroppedNotification("invalid_notification", method, params);
      },
      estimateRetainedBytes({ method, params }, 32 * 1024 * 1024),
    );
  }

  #receiveNotification(method: string, params: unknown, signal: AbortSignal): void | Promise<void> {
    if (method === "thread/attachment/updated") {
      const taskId = readTaskId(params);
      if (taskId === undefined)
        this.warnDroppedNotification("invalid_notification", method, params);
      else this.threadAttachments?.invalidate(taskId);
      return;
    }
    if (this.handleProjectStateNotification(method, params)) return;
    return this.handleNotification(method, params, signal);
  }

  public receiveServerRequest(request: RpcServerRequest): void {
    const nativeTaskId = readTaskId(request.params) ?? "";
    const taskId = this.runtime.reviewWorkerParentTaskIds.get(nativeTaskId) ?? nativeTaskId;
    // 审批与附件通知共用同一 FIFO，不能在附件未交付时越过此前事件。
    this.notificationQueue.run(
      taskId,
      () => {
        this.handleServerRequest(request);
      },
      () => {
        this.rejectServerRequest(request, { code: -32603, data: null, message: "Request failed" });
      },
      estimateRetainedBytes(request, 32 * 1024 * 1024),
    );
  }

  protected handleNotification(
    method: string,
    params: unknown,
    signal: AbortSignal,
  ): void | Promise<void> {
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
        void resumeReviewWorker(
          this.client,
          this.logger,
          this.project.id,
          reviewWorker.workerTaskId,
        );
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
    const map = (
      image: Parameters<typeof mapCodexNotification>[2],
      text: Parameters<typeof mapCodexNotification>[3],
    ) =>
      mapCodexNotification(
        method,
        params,
        image,
        text,
        activeReviewTarget,
        isReviewWorker ? reviewTurnId : undefined,
        isReviewWorker,
        hasReviewWorkerOutput && !isReviewWorker,
        isReviewWorker ? taskId : undefined,
      );
    const omitAttachment = () => undefined;
    const fallback = () => map(omitAttachment, omitAttachment);
    let mapped: AgentProviderEvent | undefined | Promise<AgentProviderEvent | undefined>;
    try {
      mapped = signal.aborted
        ? fallback()
        : resolveAttachmentMapping(
            map,
            (id, part, index) => this.mapMessageImage(id, part, index, signal),
            (id, input, index) => this.mapMessageText(id, input, index, signal),
          );
    } catch {
      this.warnDroppedNotification("invalid_notification", method, params);
      return;
    }
    return deliverNotificationAttachment(
      mapped,
      fallback,
      signal,
      (event) => {
        this.#publishMappedNotification(event, method, params);
      },
      () => {
        warnNotificationQueueRecovery(this.logger, this.project.id, method, taskId);
      },
    );
  }

  #publishMappedNotification(
    event: AgentProviderEvent | undefined,
    method: string,
    params: unknown,
  ): void {
    if (event === undefined) {
      if (!CODEX_NOTIFICATION_METHODS.has(method)) {
        this.warnDroppedNotification("unknown_notification", method, params);
      }
      return;
    }
    this.runtime.retainSnapshotEvent(event);
    if (event.type === "turn.started") {
      this.runtime.recordTaskRunning(event.taskId, true);
    }
    if (event.type === "turn.completed") {
      this.runtime.recordTaskRunning(event.taskId, false);
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
    this.notificationQueue.clearTask(taskId);
    this.taskTitles?.forget(taskId);
    if (this.threadAttachments === undefined) this.historicalAttachments.clearTask(taskId);
    else this.threadAttachments.forget(taskId);
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
    const normalizedEvent = this.runtime.messageIdentities.event(
      this.runtime.skillMessages.event(event),
    );
    // 内部订阅接收所有事件；普通订阅只接收用户可导航的持久 Task 事件。
    const notify = (listener: (event: AgentProviderEvent) => void): void => {
      try {
        listener(normalizedEvent);
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
    signal?: AbortSignal,
  ): HistoricalAttachmentResult {
    return mapCodexMessageImage(this.historicalAttachments, taskId, part, imageIndex, signal);
  }

  protected mapMessageText(
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
    signal?: AbortSignal,
  ): HistoricalAttachmentResult {
    return mapCodexMessageText(this.historicalAttachments, taskId, input, textIndex, signal);
  }

  protected assertKnownProjectTask(taskId: string): void {
    if (!this.runtime.projectTaskIds.has(taskId)) {
      throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
    }
  }
}

export class CodexAgentProvider extends CodexAgentProviderEvents implements AgentProvider {}
