import type {
  AgentProviderAttachment,
  AgentProviderEventListener,
  AgentProviderEventSubscriptionOptions,
  AgentProviderTaskSnapshot,
  AgentTaskUnsubscribeStatus,
  ReadAgentTaskInput,
  ResolvePendingRequestInput,
} from "@codexly/core";
import type { PendingRequest } from "@codexly/protocol";
import { readCodexTranscriptTurnSkills } from "./codex-transcript.js";
import {
  CodexProtocolMappingError,
  attachTranscriptSkills,
  expectRecord,
  expectString,
  isRecord,
  mapAgentTurns,
  mapThreadStatus,
} from "./codex-protocol-mapping.js";

import { CodexAgentProviderTurns } from "./agent-provider-turns.js";
import {
  createUnmaterializedTaskSnapshot,
  isProjectThread,
  isThreadNotLoadedError,
  isThreadNotMaterializedError,
  mapAgentTask,
} from "./agent-provider-base.js";
import {
  decodeTaskTurnCursor,
  encodeTaskTurnCursor,
  readNativeTaskTurnPage,
  readThreadHistoryMode,
} from "./task-history-pagination.js";
import { unsubscribeCodexThread } from "./thread-unsubscribe.js";

export abstract class CodexAgentProviderTasks extends CodexAgentProviderTurns {
  public async readTask(
    taskId: string,
    input: ReadAgentTaskInput = {},
  ): Promise<AgentProviderTaskSnapshot | undefined> {
    this.runtime.pendingTaskReads.set(taskId, (this.runtime.pendingTaskReads.get(taskId) ?? 0) + 1);
    let projectOwnershipVerified = false;
    try {
      const cursor = decodeTaskTurnCursor(input);
      let nativeResponse: unknown;
      try {
        nativeResponse = await this.client.request("thread/read", {
          includeTurns: false,
          threadId: taskId,
        });
      } catch (error) {
        const unmaterializedTask = this.runtime.unmaterializedTasks.get(taskId);
        if (unmaterializedTask !== undefined && isThreadNotMaterializedError(error)) {
          // 首条用户消息落盘前仍返回本地已知的新 Task，避免首屏读取竞态。
          projectOwnershipVerified = true;
          this.promotePendingServerRequests(taskId);
          return createUnmaterializedTaskSnapshot(unmaterializedTask);
        }
        // Codex 用明确的 RPC 错误表示 Task 不存在，其他连接与协议错误继续向上传播。
        if (isThreadNotLoadedError(error)) {
          return undefined;
        }
        throw error;
      }
      const response = expectRecord(nativeResponse, "thread/read response");
      const thread = expectRecord(response["thread"], "thread/read thread");
      if (!isProjectThread(thread, this.project)) {
        const unmaterializedTask = this.runtime.unmaterializedTasks.get(taskId);
        if (
          unmaterializedTask !== undefined &&
          thread["id"] === unmaterializedTask.id &&
          thread["projectId"] === null
        ) {
          // Codex 0.151 的内存快照会在首条消息落盘前暂时省略已分配的 projectId。
          projectOwnershipVerified = true;
          this.promotePendingServerRequests(taskId);
          return createUnmaterializedTaskSnapshot(unmaterializedTask);
        }
        return undefined;
      }
      projectOwnershipVerified = true;
      // Project 归属确认后才提升读取期间暂存的 Server Request。
      this.promotePendingServerRequests(taskId);
      const task = await mapAgentTask(thread, this.project);
      this.runtime.goals.delete(taskId);
      const requestedGoal = await this.readGoalResponse(taskId);
      // goal/get 期间到达的通知时序更新，必须优先于可能已经过期的 RPC 响应。
      const goal = this.runtime.goals.has(taskId)
        ? (this.runtime.goals.get(taskId) ?? null)
        : requestedGoal;
      let nativePage: Awaited<ReturnType<typeof readNativeTaskTurnPage>>;
      try {
        nativePage = await readNativeTaskTurnPage(
          this.client,
          taskId,
          readThreadHistoryMode(thread),
          cursor.turnCursor,
        );
      } catch (error) {
        const unmaterializedTask = this.runtime.unmaterializedTasks.get(taskId);
        if (
          cursor.turnCursor === undefined &&
          unmaterializedTask !== undefined &&
          isThreadNotMaterializedError(error)
        ) {
          // Codex 首条消息前允许读取元数据，但分页历史尚不可用。
          return createUnmaterializedTaskSnapshot(unmaterializedTask);
        }
        throw error;
      }
      const reviewPage = await this.readReviewWorkerTurns(
        taskId,
        nativePage.turns,
        cursor.reviewCursor,
      );
      const transcriptSkillsByTurnId = await readCodexTranscriptTurnSkills(taskId);
      // Store 为未变化的来源复用随机授权 ID，重复读取不能使已交付的 Snapshot 图片失效。
      const turns = mapAgentTurns(
        reviewPage.turns,
        (part, imageIndex) => this.mapMessageImage(taskId, part, imageIndex),
        (input, textIndex) => this.mapMessageText(taskId, input, textIndex),
      ).map((turn) => attachTranscriptSkills(turn, transcriptSkillsByTurnId.get(turn.id) ?? []));
      const status = turns.some((turn) => turn.status === "running")
        ? "running"
        : mapThreadStatus(thread["status"]);
      const runningReviewTurn = turns.findLast(
        (turn) => turn.status === "running" && turn.items.some((item) => item.type === "review"),
      );
      const runningReviewItem = runningReviewTurn?.items.find((item) => item.type === "review");
      if (runningReviewTurn !== undefined && runningReviewItem?.type === "review") {
        // 服务重启或页面刷新后，从规范化 Snapshot 恢复后续实时通知所需的父级映射。
        this.runtime.activeReviewTargets.set(taskId, runningReviewItem.target);
        this.runtime.activeReviewTurnIds.set(taskId, runningReviewTurn.id);
        this.runtime.activeReviewWorkerTaskIds.add(taskId);
      }
      if (status === "running") {
        this.runtime.runningTaskIds.add(taskId);
      } else {
        this.runtime.runningTaskIds.delete(taskId);
      }
      const snapshot: AgentProviderTaskSnapshot = {
        ...task,
        contextUsage: this.runtime.contextUsage.get(taskId) ?? null,
        goal,
        plan: this.runtime.plans.get(taskId) ?? null,
        pendingRequests: this.pendingLifecycle.pendingForTask(taskId),
        status,
        turns,
        turnsNextCursor: encodeTaskTurnCursor(
          nativePage.nextTurnCursor,
          reviewPage.nextReviewCursor,
        ),
      };
      return snapshot;
    } finally {
      this.finishTaskRead(taskId, projectOwnershipVerified);
    }
  }

  protected async readReviewWorkerTurns(
    taskId: string,
    parentTurns: readonly unknown[],
    reviewCursor: string | null | undefined,
  ): Promise<Readonly<{ nextReviewCursor: string | null | undefined; turns: unknown[] }>> {
    const reviewTurnIndexes = parentTurns.flatMap((turn, turnIndex) => {
      const nativeTurn = expectRecord(turn, "Codex turn");
      const items = nativeTurn["items"];
      return Array.isArray(items) &&
        items.some((item) => isRecord(item) && item["type"] === "enteredReviewMode")
        ? [turnIndex]
        : [];
    });
    if (reviewTurnIndexes.length === 0) {
      return { nextReviewCursor: reviewCursor, turns: [...parentTurns] };
    }

    if (reviewCursor === null) {
      return { nextReviewCursor: null, turns: [...parentTurns] };
    }

    // 主历史与 reviewer 都按 newest-first 使用各自 Cursor，同一页只读取需要配对的 worker。
    const listResponse = expectRecord(
      await this.client.request("thread/list", {
        ...(typeof reviewCursor === "string" ? { cursor: reviewCursor } : {}),
        limit: reviewTurnIndexes.length,
        parentThreadId: taskId,
        sortDirection: "desc",
        sortKey: "created_at",
        sourceKinds: ["subAgentReview"],
        useStateDbOnly: true,
      }),
      "review worker thread/list response",
    );
    if (!Array.isArray(listResponse["data"])) {
      throw new CodexProtocolMappingError("review worker thread/list data must be an array");
    }
    const workerThreads: unknown[] = listResponse["data"].map((value: unknown) => value);
    if (workerThreads.length > reviewTurnIndexes.length) {
      throw new CodexProtocolMappingError("review worker pagination is inconsistent");
    }
    const nativeNextCursor = listResponse["nextCursor"];
    const nextReviewCursor =
      nativeNextCursor === null
        ? null
        : expectString(nativeNextCursor, "review worker thread/list next cursor");
    if (
      typeof nextReviewCursor === "string" &&
      (nextReviewCursor.length === 0 || nextReviewCursor === reviewCursor)
    ) {
      throw new CodexProtocolMappingError("review worker thread/list returned a repeated cursor");
    }

    // thread/list 已返回 historyMode；直接并发分页读取最多 10 个 worker，去掉元数据 RPC 瀑布。
    const workerPages = await Promise.all(
      workerThreads.reverse().map(async (workerThreadValue) => {
        const workerThread = expectRecord(workerThreadValue, "Codex review worker thread");
        const workerTaskId = expectString(workerThread["id"], "Codex review worker thread id");
        const workerPage = await readNativeTaskTurnPage(
          this.client,
          workerTaskId,
          readThreadHistoryMode(workerThread),
        );
        const workerTurns = workerPage.turns;
        const runningWorkerTurn = workerTurns.findLast((turn) => {
          const nativeTurn = expectRecord(turn, "Codex review worker turn");
          return nativeTurn["status"] === "inProgress";
        });
        return {
          runningTurnId:
            runningWorkerTurn === undefined
              ? undefined
              : expectString(
                  expectRecord(runningWorkerTurn, "Codex running review worker turn")["id"],
                  "Codex running review worker turn id",
                ),
          workerTaskId,
          workerTurns,
        };
      }),
    );

    // 并发完成顺序不稳定，统一按历史顺序更新运行时映射，确保最新 worker 最终生效。
    for (const workerPage of workerPages) {
      const { runningTurnId, workerTaskId } = workerPage;
      this.runtime.reviewWorkerParentTaskIds.set(workerTaskId, taskId);
      this.runtime.reviewWorkerTaskIds.set(taskId, workerTaskId);
      if (runningTurnId !== undefined) {
        this.runtime.reviewWorkerTurnIds.set(taskId, runningTurnId);
      }
    }

    const turns: unknown[] = [];
    let workerIndex = 0;
    for (let turnIndex = 0; turnIndex < parentTurns.length; turnIndex += 1) {
      turns.push(parentTurns[turnIndex]);
      if (reviewTurnIndexes[workerIndex] === turnIndex) {
        turns.push(...(workerPages[workerIndex]?.workerTurns ?? []));
        workerIndex += 1;
      }
    }
    return { nextReviewCursor, turns };
  }

  public async readTaskAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<AgentProviderAttachment | undefined> {
    if (!this.runtime.projectTaskIds.has(taskId)) {
      return undefined;
    }
    return this.historicalAttachments.read(taskId, attachmentId);
  }

  public async resolvePendingRequest(input: ResolvePendingRequestInput): Promise<PendingRequest> {
    return this.pendingLifecycle.resolve(input);
  }

  public subscribeEvents(
    listener: AgentProviderEventListener,
    options: AgentProviderEventSubscriptionOptions = {},
  ): () => void {
    const listeners =
      options.includeEphemeral === true
        ? this.eventListenersIncludingEphemeral
        : this.eventListeners;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  public async unsubscribeTask(taskId: string): Promise<AgentTaskUnsubscribeStatus> {
    if (!this.runtime.projectTaskIds.has(taskId)) {
      return "notLoaded";
    }
    if (this.hasTaskLifecycleObligations(taskId)) {
      return "busy";
    }
    const terminals = await this.listBackgroundTerminals(taskId);
    if (terminals.data.length > 0 || this.hasTaskLifecycleObligations(taskId)) {
      return "busy";
    }

    const status = await unsubscribeCodexThread(this.client, taskId);
    this.clearTaskRuntimeState(taskId);
    return status;
  }
}
