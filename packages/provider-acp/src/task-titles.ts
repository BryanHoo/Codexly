import { randomUUID } from "node:crypto";
import {
  boundTaskTitleInput,
  type AgentProviderEvent,
  type AgentProviderTurnInput,
  type LocalCatalogStore,
  type LocalTask,
} from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";

interface Job {
  controller: AbortController;
  settled: Promise<void>;
}
/** 只在 agent 接受首发后后台命名；跨进程唯一性与手动名称优先由目录事务保证。 */
export class AcpTaskTitles {
  readonly #pending = new Map<string, { task: LocalTask; text: string }>();
  readonly #active = new Map<string, Job>();
  readonly #seen = new Set<string>();
  #closed = false;
  constructor(
    readonly store: LocalCatalogStore,
    readonly engine: AgentEngine,
    readonly projectId: string | null,
    readonly hasTurns: (id: string) => Promise<boolean>,
    readonly generate: (task: LocalTask, text: string, signal: AbortSignal) => Promise<string>,
    readonly publish: (id: string, title: string) => void,
  ) {}
  async prepare(task: LocalTask, input: AgentProviderTurnInput): Promise<void> {
    if (this.#closed || task.title || this.#seen.has(task.id) || this.#active.has(task.id)) return;
    // 首发检查只读历史指针，不读取整页或偏好，不在主聊天路径调用模型。
    if (await this.hasTurns(task.id).catch(() => true)) return;
    // 历史检查期间可能关闭，必须在保留待处理正文之前重新读取生命周期状态。
    if (this.#isClosed() || this.#pending.size >= 64) return;
    const text = boundTaskTitleInput(
      input.text.trim() ||
        ([...input.files, ...input.textAttachments].find((item) => item.name.trim())?.name ??
          "图片任务"),
    );
    this.#pending.set(task.id, { task, text });
  }
  receive(event: AgentProviderEvent): void {
    if (event.type === "task.metadata_changed" || event.type === "task.removed") {
      this.#cancel(event.taskId);
      return;
    }
    if (event.type === "turn.completed") {
      if (event.payload.turn.status === "completed") this.#start(event.taskId);
      else this.#cancel(event.taskId);
    } else if (
      event.type === "item.started" &&
      !(event.payload.item.type === "message" && event.payload.item.role === "user")
    ) {
      this.#start(event.taskId);
    }
  }
  #cancel(id: string): void {
    this.#pending.delete(id);
    this.#active.get(id)?.controller.abort();
  }
  #start(id: string): void {
    const pending = this.#pending.get(id);
    this.#pending.delete(id);
    if (this.#closed || !pending || this.#active.size >= 2) return;
    this.#seen.add(id);
    const oldest = this.#seen.values().next().value;
    if (this.#seen.size > 256 && oldest !== undefined) this.#seen.delete(oldest);
    const controller = new AbortController();
    // 先登记活跃作业，后领取；取消发生在目录响应期间也不会留下未受控模型请求。
    const job: Job = { controller, settled: Promise.resolve() };
    this.#active.set(id, job);
    job.settled = this.#run(pending.task, pending.text, controller.signal)
      .catch(() => undefined)
      .finally(() => {
        this.#active.delete(id);
      });
  }
  async #run(task: LocalTask, text: string, signal: AbortSignal): Promise<void> {
    const token = randomUUID();
    if (
      !(await this.store.catalog("acp.title.claim", {
        id: task.id,
        token,
        engine: this.engine,
        projectId: this.projectId,
      }))
    )
      return;
    let title: string | null = null;
    try {
      signal.throwIfAborted();
      title = await this.generate(task, text, signal);
      signal.throwIfAborted();
    } catch {
      /* 后台失败消耗本次领取，不能触发旧 SDK 或影响主回合。 */
    }
    const stored = await this.store.catalog("acp.title.finish", {
      id: task.id,
      token,
      title: signal.aborted ? null : title,
    });
    if (stored && !this.#closed) this.publish(task.id, stored);
  }
  cancel(): void {
    this.#closed = true;
    this.#pending.clear();
    for (const job of this.#active.values()) job.controller.abort();
  }
  #isClosed(): boolean {
    return this.#closed;
  }
  async settled(): Promise<void> {
    await Promise.allSettled([...this.#active.values()].map((job) => job.settled));
  }
}
