import { createHash, randomUUID } from "node:crypto";
import {
  collectQuestionGroups,
  formatQuestionAnswers,
  type AsyncQuestionRepository,
  type AgentProviderTaskSnapshot,
} from "@codexly/core";
import type { AsyncQuestionGroup, AnswerAsyncQuestionResponse } from "@codexly/protocol";
import { MutationHttpError, type ServerRouteContext } from "./routes/context.js";

const identify = (value: string) => createHash("sha256").update(value).digest("hex");
export class AsyncQuestionService {
  readonly #anchors = new Map<string, string>();
  readonly #refreshes = new Map<string, Promise<void>>();
  constructor(private readonly context: ServerRouteContext) {}

  private repository(): AsyncQuestionRepository {
    const repository = this.context.asyncQuestionRepository;
    if (repository === undefined)
      throw new MutationHttpError(
        "PROVIDER_ERROR",
        "Async question persistence is unavailable",
        503,
      );
    return repository;
  }
  private async task(projectId: string, taskId: string) {
    const runtime = await this.context.getProjectContext(projectId);
    if (runtime === undefined)
      throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
    const task = await runtime.provider.readTask(taskId);
    if (task?.projectId !== runtime.scope.id)
      throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
    return { runtime, task };
  }
  private refresh(projectId: string, taskId: string): Promise<void> {
    const key = JSON.stringify([projectId, taskId]);
    const existing = this.#refreshes.get(key);
    if (existing !== undefined) return existing;
    const pending = this.discover(projectId, taskId, key).finally(() => {
      this.#refreshes.delete(key);
    });
    this.#refreshes.set(key, pending);
    return pending;
  }
  private async discover(projectId: string, taskId: string, key: string) {
    const repository = this.repository();
    const { runtime, task } = await this.task(projectId, taskId);
    const previousAnchor = this.#anchors.get(key);
    const newestId = task.turns.at(-1)?.id;
    let page: AgentProviderTaskSnapshot = task;
    const cursors = new Set<string>();
    for (let count = 0; ; count++) {
      await repository.discoverAsyncQuestions(
        projectId,
        taskId,
        collectQuestionGroups(page.turns, identify),
      );
      // 首次扫描历史，后续只补齐上次锚点之后的回合；不在每次轮询中重扫整个会话。
      if (page.turnsNextCursor === null || page.turns.some((turn) => turn.id === previousAnchor))
        break;
      const cursor = page.turnsNextCursor;
      if (count >= 199 || cursors.has(cursor))
        throw new MutationHttpError(
          "PROVIDER_ERROR",
          "Async question history scan limit exceeded",
          503,
        );
      cursors.add(cursor);
      const next = await runtime.provider.readTask(taskId, { cursor });
      if (next?.projectId !== runtime.scope.id)
        throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
      page = next;
    }
    if (newestId !== undefined) {
      this.#anchors.delete(key);
      this.#anchors.set(key, newestId);
      const oldest = this.#anchors.keys().next().value;
      if (this.#anchors.size > 128 && oldest !== undefined) this.#anchors.delete(oldest);
    }
  }
  public async list(projectId: string, taskId: string) {
    await this.refresh(projectId, taskId);
    return this.pending(projectId, taskId);
  }
  private async pending(projectId: string, taskId: string) {
    const records = await this.repository().listAsyncQuestions(projectId, taskId);
    return {
      data: records
        .map((record) => record.group)
        .filter((group) => group.status === "pending" || group.status === "answering"),
    };
  }
  public async dismiss(projectId: string, taskId: string, ids: readonly string[]) {
    await this.task(projectId, taskId);
    await this.repository().dismissAsyncQuestions(projectId, taskId, ids);
    return this.pending(projectId, taskId);
  }
  public async answer(
    projectId: string,
    taskId: string,
    id: string,
    answers: readonly string[],
  ): Promise<AnswerAsyncQuestionResponse> {
    const repository = this.repository();
    const { runtime, task } = await this.task(projectId, taskId);
    const record = (await repository.listAsyncQuestions(projectId, taskId)).find(
      (item) => item.group.id === id,
    );
    if (record === undefined)
      throw new MutationHttpError("ASYNC_QUESTION_NOT_FOUND", "Async question not found", 404);
    const fingerprint = identify(JSON.stringify(answers.map((answer) => answer.trim())));
    if (record.fingerprint !== undefined && record.fingerprint !== fingerprint)
      throw new MutationHttpError(
        "ASYNC_QUESTION_RESOLVED",
        "Async question already has another answer",
        409,
      );
    if (record.group.status === "answered" && record.result !== undefined) return record.result;
    if (record.group.status === "answering") throw this.unknownOutcome();
    if (record.group.status !== "pending")
      throw new MutationHttpError(
        "ASYNC_QUESTION_RESOLVED",
        "Async question is no longer pending",
        409,
      );
    let text: string;
    try {
      text = formatQuestionAnswers(record.group.questions, answers);
    } catch {
      throw new MutationHttpError("INVALID_REQUEST", "Invalid question answers", 400);
    }
    const input = { type: "prompt" as const, text, attachments: [], skills: [] };
    const running = task.turns.findLast((turn) => turn.status === "running");
    const settings = await this.context.readEffectiveTaskSettings(projectId, taskId);
    if (running === undefined)
      this.context.assertValidProjectDefaults(await this.context.listModels(), settings);
    const claimed = { group: { ...record.group, status: "answering" as const }, fingerprint };
    // 所有可重试的校验先完成，紧邻 Provider 调用前原子占用，跨请求和重启都不重复投递。
    if (!(await repository.updateAsyncQuestion(projectId, taskId, claimed, "pending")))
      throw new MutationHttpError(
        "ASYNC_QUESTION_RESOLVED",
        "Async question is being resolved",
        409,
      );
    const checkpoint = runtime.eventStream.checkpoint;
    const providerInput = { text, skills: [], files: [], images: [], textAttachments: [] };
    try {
      const turn =
        running === undefined
          ? await runtime.provider.startTurn(taskId, providerInput, settings)
          : null;
      if (running !== undefined)
        await runtime.provider.steerTurn(taskId, running.id, providerInput);
      const turnId = turn?.id ?? running?.id;
      if (turnId === undefined) throw new Error("Answer turn is unavailable");
      const group: AsyncQuestionGroup = { ...record.group, status: "answered" };
      const result = { question: group, input, messageId: randomUUID(), turnId, turn, checkpoint };
      if (
        !(await repository.updateAsyncQuestion(
          projectId,
          taskId,
          { group, fingerprint, result },
          "answering",
        ))
      )
        throw new Error("Answer state changed unexpectedly");
      return result;
    } catch {
      throw this.unknownOutcome();
    }
  }
  private unknownOutcome() {
    return new MutationHttpError(
      "SUBMISSION_OUTCOME_UNKNOWN",
      "Answer delivery outcome is unknown; inspect the task before sending again",
      409,
    );
  }
}
