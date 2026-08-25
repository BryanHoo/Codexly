import type {
  AgentProviderEventListener,
  AgentProviderTurnInput,
  ListAgentTasksInput,
  StartAgentTaskOptions,
} from "@codexly/core";
import type {
  AgentBackgroundTerminal,
  AgentBackgroundTerminalPage,
  AgentGoal,
  AgentTask,
  AgentTaskPage,
  AgentTurn,
  AgentTurnOptions,
  AgentReviewTarget,
  UploadAgentFeedbackRequest,
  UpdateAgentGoalRequest,
} from "@codexly/protocol";
import {
  CodexProtocolMappingError,
  expectBoolean,
  expectRecord,
  expectString,
  mapAgentTurn,
  mapBackgroundTerminal,
  mapSandboxPolicy,
  optionalString,
} from "./codex-protocol-mapping.js";

import { CODEX_PINNED_THREAD_SECTION_ID } from "./agent-provider-base.js";
import { isBackgroundTerminalThreadMissingError, mapAgentTask } from "./agent-provider-base.js";
import { CodexAgentProviderQueue } from "./agent-provider-queue.js";
import { mapCodexGoal } from "./codex-goal-mapping.js";

function mapCodexTurnSettings(options: AgentTurnOptions) {
  // 普通 Turn 与 Goal 自动 Turn 必须使用完全相同的执行设置。
  return {
    approvalPolicy: options.approvalPolicy,
    approvalsReviewer: options.approvalsReviewer,
    collaborationMode: {
      mode: options.collaborationMode === "plan" ? ("plan" as const) : ("default" as const),
      settings: {
        developer_instructions: null,
        model: options.model,
        reasoning_effort: options.reasoningEffort,
      },
    },
    effort: options.reasoningEffort,
    model: options.model,
    sandboxPolicy: mapSandboxPolicy(options.sandboxMode),
    // Codex 会把 Service Tier 粘附到 Thread，关闭时必须显式清除。
    serviceTier: options.fastMode === true ? "fast" : null,
  };
}

export abstract class CodexAgentProviderTurns extends CodexAgentProviderQueue {
  public async startTask(options: StartAgentTaskOptions = {}): Promise<AgentTask> {
    const response = expectRecord(
      await this.client.request("thread/start", {
        cwd: this.project.rootPath,
        historyMode: "paginated",
        ...(this.project.kind === "temporary" ? {} : { projectId: this.project.id }),
        // Project 身份与运行时文件系统授权彼此独立，必须显式传递完整根列表。
        runtimeWorkspaceRoots: [...this.project.runtimeWorkspaceRoots],
        ...(options.ephemeral === true ? { ephemeral: true } : {}),
      }),
      "thread/start response",
    );
    const task = await mapAgentTask(
      expectRecord(response["thread"], "thread/start thread"),
      this.project,
    );
    // 新建 Task 必须立即接收后续 Turn 通知，不能等待下一次列表刷新。
    this.runtime.projectTaskIds.add(task.id);
    this.runtime.resumedTaskIds.add(task.id);
    if (options.ephemeral === true) {
      // 临时 Task 保留内部事件路由，但不能进入默认事件订阅或用户可见列表。
      this.runtime.ephemeralTaskIds.add(task.id);
    } else {
      this.runtime.unmaterializedTasks.set(task.id, task);
    }
    return task;
  }

  public async startTurn(
    taskId: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
    this.assertKnownProjectTask(taskId);
    await this.resumeTask(taskId);
    if (options.goalMode === true) {
      if (
        input.files.length > 0 ||
        input.images.length > 0 ||
        input.skills.length > 0 ||
        input.textAttachments.length > 0
      ) {
        // thread/goal/set 只接受目标文本，禁止把结构化输入无提示地丢弃。
        throw new CodexProtocolMappingError(
          "Codex goals do not support structured attachments or skills",
        );
      }
      const objective = input.text.trim();
      if (objective.length === 0 || objective.length > 4_000) {
        throw new CodexProtocolMappingError(
          "Codex goal objective must contain between 1 and 4000 characters",
        );
      }
      let resolveStartedTurn: (turn: AgentTurn) => void = () => undefined;
      const startedTurn = new Promise<AgentTurn>((resolve) => {
        resolveStartedTurn = resolve;
      });
      const listener: AgentProviderEventListener = (event) => {
        if (event.taskId === taskId && event.type === "turn.started") {
          resolveStartedTurn(event.payload.turn);
        }
      };
      this.eventListeners.add(listener);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        expectRecord(
          await this.client.request("thread/settings/update", {
            ...mapCodexTurnSettings(options),
            threadId: taskId,
          }),
          "thread/settings/update response",
        );
        const goalResponse = expectRecord(
          await this.client.request("thread/goal/set", {
            objective,
            status: "active",
            threadId: taskId,
          }),
          "thread/goal/set response",
        );
        const goal = mapCodexGoal(goalResponse["goal"], taskId);
        // Goal 会自动启动首个 Turn；校验持久目标后等待对应的启动通知。
        if (goal.objective !== objective) {
          throw new CodexProtocolMappingError("thread/goal/set returned an unexpected goal");
        }
        const timeoutTurn = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new CodexProtocolMappingError("thread/goal/set did not start a turn"));
          }, 30_000);
          timeout.unref();
        });
        return await Promise.race([startedTurn, timeoutTurn]);
      } finally {
        this.eventListeners.delete(listener);
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      }
    }
    const codexInput = await this.mapTurnInput(input);
    const response = expectRecord(
      await this.client.request("turn/start", {
        // Codex collaboration mode 会粘附到 Thread；普通 Turn 必须显式恢复默认执行模式。
        ...mapCodexTurnSettings(options),
        input: codexInput,
        ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
        threadId: taskId,
      }),
      "turn/start response",
    );
    const turn = mapAgentTurn(
      response["turn"],
      (part, imageIndex) => this.mapMessageImage(taskId, part, imageIndex),
      (input, textIndex) => this.mapMessageText(taskId, input, textIndex),
    );
    if (turn.status === "running") {
      this.runtime.runningTaskIds.add(taskId);
    }
    return turn;
  }

  protected async readGoalResponse(taskId: string): Promise<AgentGoal | null> {
    const response = expectRecord(
      await this.client.request("thread/goal/get", { threadId: taskId }),
      "thread/goal/get response",
    );
    const nativeGoal = response["goal"];
    return nativeGoal === null ? null : mapCodexGoal(nativeGoal, taskId);
  }

  public async readGoal(taskId: string): Promise<AgentGoal | null> {
    this.assertKnownProjectTask(taskId);
    return this.readGoalResponse(taskId);
  }

  public async updateGoal(taskId: string, input: UpdateAgentGoalRequest): Promise<AgentGoal> {
    this.assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.client.request("thread/goal/set", { ...input, threadId: taskId }),
      "thread/goal/set response",
    );
    return mapCodexGoal(response["goal"], taskId);
  }

  public async clearGoal(taskId: string): Promise<void> {
    this.assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.client.request("thread/goal/clear", { threadId: taskId }),
      "thread/goal/clear response",
    );
    expectBoolean(response["cleared"], "thread/goal/clear cleared");
  }

  public async steerTurn(
    taskId: string,
    turnId: string,
    input: AgentProviderTurnInput,
  ): Promise<void> {
    this.assertKnownProjectTask(taskId);
    const codexInput = await this.mapTurnInput(input);
    const response = expectRecord(
      await this.client.request("turn/steer", {
        expectedTurnId: turnId,
        input: codexInput,
        threadId: taskId,
      }),
      "turn/steer response",
    );
    if (response["turnId"] !== turnId) {
      throw new CodexProtocolMappingError("turn/steer returned an unexpected turn id");
    }
  }

  public async startReview(taskId: string, target: AgentReviewTarget): Promise<AgentTurn> {
    this.assertKnownProjectTask(taskId);
    const nativeTarget =
      target.type === "uncommitted_changes"
        ? { type: "uncommittedChanges" as const }
        : target.type === "base_branch"
          ? { branch: target.branch, type: "baseBranch" as const }
          : target.type === "commit"
            ? { sha: target.sha, title: target.title ?? null, type: "commit" as const }
            : { instructions: target.instructions, type: "custom" as const };
    // Notification 可能早于 RPC 响应到达，先记录目标以隐藏内部 Prompt 并生成稳定审查 Item。
    this.runtime.activeReviewTargets.set(taskId, target);
    let response: Record<string, unknown>;
    try {
      response = expectRecord(
        await this.client.request("review/start", {
          delivery: "inline",
          target: nativeTarget,
          threadId: taskId,
        }),
        "review/start response",
      );
    } catch (error) {
      this.runtime.activeReviewTargets.delete(taskId);
      this.runtime.activeReviewTurnIds.delete(taskId);
      this.runtime.activeReviewWorkerTaskIds.delete(taskId);
      this.runtime.reviewWorkerOutputTaskIds.delete(taskId);
      throw error;
    }
    if (expectString(response["reviewThreadId"], "review/start thread id") !== taskId) {
      throw new CodexProtocolMappingError("review/start returned a different thread");
    }
    const turn = mapAgentTurn(
      response["turn"],
      (part, imageIndex) => this.mapMessageImage(taskId, part, imageIndex),
      (input, textIndex) => this.mapMessageText(taskId, input, textIndex),
      target,
    );
    // enteredReviewMode 通常先到；RPC 结果是外层 Turn ID 的最终校准来源。
    this.runtime.activeReviewTurnIds.set(taskId, turn.id);
    if (turn.status !== "running") {
      this.runtime.activeReviewTargets.delete(taskId);
      this.runtime.activeReviewTurnIds.delete(taskId);
      this.runtime.activeReviewWorkerTaskIds.delete(taskId);
      this.runtime.reviewWorkerOutputTaskIds.delete(taskId);
    }
    return turn;
  }

  public async interruptTurn(taskId: string, turnId: string): Promise<void> {
    this.assertKnownProjectTask(taskId);
    // review 的外层 Turn 只负责展示，真正可终止的是 reviewer 子 Thread 的运行中 Turn。
    const interruptTaskId = this.runtime.reviewWorkerTaskIds.get(taskId) ?? taskId;
    const interruptTurnId = this.runtime.reviewWorkerTurnIds.get(taskId) ?? turnId;
    expectRecord(
      await this.client.request("turn/interrupt", {
        threadId: interruptTaskId,
        turnId: interruptTurnId,
      }),
      "turn/interrupt response",
    );
  }

  public async listBackgroundTerminals(taskId: string): Promise<AgentBackgroundTerminalPage> {
    this.assertKnownProjectTask(taskId);
    const terminals: AgentBackgroundTerminal[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    try {
      do {
        const response = expectRecord(
          await this.client.request("thread/backgroundTerminals/list", {
            ...(cursor === undefined ? {} : { cursor }),
            limit: 100,
            threadId: taskId,
          }),
          "thread/backgroundTerminals/list response",
        );
        if (!Array.isArray(response["data"])) {
          throw new CodexProtocolMappingError("background terminal list data must be an array");
        }
        terminals.push(...response["data"].map(mapBackgroundTerminal));
        const nextCursor = optionalString(response["nextCursor"]);
        if (nextCursor === undefined) {
          cursor = undefined;
        } else {
          if (seenCursors.has(nextCursor)) {
            throw new CodexProtocolMappingError("background terminal list cursor must advance");
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }
      } while (cursor !== undefined);
    } catch (error) {
      if (isBackgroundTerminalThreadMissingError(error)) {
        // 历史 Task 可从持久化记录读取，但未加载到当前运行时，因此不可能存在后台终端。
        return { data: [] };
      }
      throw error;
    }

    return { data: terminals };
  }

  public async terminateBackgroundTerminal(taskId: string, terminalId: string): Promise<boolean> {
    this.assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.client.request("thread/backgroundTerminals/terminate", {
        processId: terminalId,
        threadId: taskId,
      }),
      "thread/backgroundTerminals/terminate response",
    );
    return expectBoolean(response["terminated"], "background terminal terminate result");
  }

  public async uploadFeedback(taskId: string, input: UploadAgentFeedbackRequest): Promise<void> {
    this.assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.client.request("feedback/upload", { ...input, threadId: taskId }),
      "feedback/upload response",
    );
    if (expectString(response["threadId"], "feedback/upload thread id") !== taskId) {
      throw new CodexProtocolMappingError("feedback/upload returned a different thread");
    }
  }

  public async listTasks(input: ListAgentTasksInput = {}): Promise<AgentTaskPage> {
    const response = expectRecord(
      await this.client.request("thread/list", {
        ...(input.archived === true ? { archived: true } : {}),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(this.project.kind === "temporary"
          ? { cwd: this.project.rootPath, projectId: null }
          : { projectId: this.project.id }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        // 锁定版本用稳定 Pinned Section 过滤，保证固定任务先过滤再分页。
        ...(input.pinnedOnly === true ? { sectionId: CODEX_PINNED_THREAD_SECTION_ID } : {}),
        ...(input.searchTerm === undefined ? {} : { searchTerm: input.searchTerm }),
        sortDirection: "desc",
        sortKey: "updated_at",
      }),
      "thread/list response",
    );
    if (!Array.isArray(response["data"])) {
      throw new CodexProtocolMappingError("thread/list data must be an array");
    }
    const nextCursor = response["nextCursor"];
    if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== "string") {
      throw new CodexProtocolMappingError("thread/list nextCursor must be a string or null");
    }
    const nativeTasks = await Promise.all(
      response["data"].map((thread) =>
        mapAgentTask(expectRecord(thread, "Codex thread"), this.project),
      ),
    );
    for (const task of nativeTasks) {
      this.runtime.projectTaskIds.add(task.id);
      this.runtime.unmaterializedTasks.delete(task.id);
    }
    // thread/list 可能晚于 thread/start materialize；首屏先合并本地已确认的新 Task。
    const pendingTasks =
      input.cursor === undefined && input.archived !== true && input.searchTerm === undefined
        ? [...this.runtime.unmaterializedTasks.values()].toSorted((leftTask, rightTask) =>
            rightTask.updatedAt.localeCompare(leftTask.updatedAt),
          )
        : [];
    const data = [...pendingTasks, ...nativeTasks];
    return { data, nextCursor: nextCursor ?? null };
  }
}
