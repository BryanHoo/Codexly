import type { AgentProviderTurnInput, AgentTaskScope } from "@codexly/core";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import type { CodexProviderLogger } from "./agent-provider-logger.js";
import { expectRecord } from "./codex-protocol-mapping.js";
import {
  generateTaskTitle,
  taskTitlePrompt,
  type SubscribeTitleNotifications,
} from "./task-title-generation.js";

interface PendingTitle {
  project: AgentTaskScope;
  cwd: string;
}
type ActiveTitle = PendingTitle & { controller: AbortController; done: Promise<void> };

export class CodexTaskTitles {
  readonly #pending = new Map<string, PendingTitle>();
  readonly #active = new Map<string, ActiveTitle>();
  readonly #mutations = new Map<string, Promise<unknown>>();
  readonly #listeners = new Set<Parameters<SubscribeTitleNotifications>[0]>();

  public constructor(
    private readonly client: CodexRpcClient,
    private readonly readModel: () => Promise<string>,
    private readonly logger: CodexProviderLogger,
  ) {}

  public receiveNotification(
    notification: Parameters<Parameters<SubscribeTitleNotifications>[0]>[0],
  ): void {
    for (const listener of this.#listeners) listener(notification);
  }

  public register(taskId: string, project: AgentTaskScope, cwd: string): void {
    this.#pending.set(taskId, { project, cwd });
  }

  public start(taskId: string, input: AgentProviderTurnInput): void {
    const pending = this.#pending.get(taskId);
    if (pending === undefined) return;
    // 首次成功发送后同步领取，后续 Turn、失败重试及并发提交都不能重复生成。
    this.#pending.delete(taskId);
    const fallback =
      [...input.skills, ...input.files, ...input.textAttachments]
        .map((item) => item.name.trim())
        .find(Boolean) ?? "新任务";
    const prompt = taskTitlePrompt(input.text.trim() || fallback);
    const controller = new AbortController();
    const active: ActiveTitle = { ...pending, controller, done: Promise.resolve() };
    this.#active.set(taskId, active);
    // 设置读取也延后执行，主 Turn 返回不等待模型目录、数据库或辅助请求。
    active.done = Promise.resolve()
      .then(async () => {
        const model = await this.readModel();
        controller.signal.throwIfAborted();
        const title = await generateTaskTitle(
          this.client,
          (listener) => {
            this.#listeners.add(listener);
            return () => {
              this.#listeners.delete(listener);
            };
          },
          pending.cwd,
          model,
          prompt,
          controller.signal,
        );
        await this.mutate(taskId, async () => {
          controller.signal.throwIfAborted();
          const response = expectRecord(
            await this.client.request("thread/read", {
              threadId: taskId,
              includeTurns: false,
            }),
            "thread/read response",
          );
          const thread = expectRecord(response["thread"], "task title thread");
          const projectId = pending.project.kind === "temporary" ? null : pending.project.id;
          if (thread["id"] !== taskId || thread["projectId"] !== projectId) {
            throw new Error("Task title ownership mismatch");
          }
          // 原生名称优先于自动摘要，不能把 preview 当作已命名状态。
          if (typeof thread["name"] === "string" && thread["name"].trim()) return;
          controller.signal.throwIfAborted();
          await this.client.request("thread/name/set", { threadId: taskId, name: title });
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          this.logger.warn(
            { diagnosticCode: "task_title_generation_failed" },
            "Automatic task title unavailable",
          );
        }
      })
      .finally(() => {
        if (this.#active.get(taskId) === active) this.#active.delete(taskId);
      });
  }

  public async mutate<T>(taskId: string, action: () => Promise<T>): Promise<T> {
    // 自动读写与手动命名共用任务锁；不同任务互不阻塞，失败后也必须释放。
    const previous = this.#mutations.get(taskId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.#mutations.set(taskId, current);
    try {
      return await current;
    } finally {
      if (this.#mutations.get(taskId) === current) this.#mutations.delete(taskId);
    }
  }

  public forget(taskId: string): void {
    this.#pending.delete(taskId);
    this.#active.get(taskId)?.controller.abort();
  }

  public async releaseProject(projectId: string): Promise<void> {
    for (const [taskId, pending] of this.#pending) {
      if (pending.project.id === projectId) this.#pending.delete(taskId);
    }
    const active = [...this.#active.values()].filter((entry) => entry.project.id === projectId);
    for (const entry of active) entry.controller.abort();
    await Promise.all(active.map((entry) => entry.done));
  }
}
