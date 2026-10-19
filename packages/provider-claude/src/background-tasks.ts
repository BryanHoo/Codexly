import { record, text } from "./sdk-values.js";

interface NativeTask {
  runId?: string;
  toolId?: string;
  background?: boolean;
  status?: string;
  notified?: boolean;
}

/** 每个 CLI 进程共用一份原生任务表；集合信号与边沿状态独立保存，不能按到达顺序配对。 */
export class ClaudeBackgroundTasks {
  readonly #tasks = new Map<string, NativeTask>();
  readonly #tools = new Map<string, string>();
  readonly #hints = new Set<string>();
  readonly #active = new Set<string>();
  #live: Set<string> | undefined;

  get hasSnapshot(): boolean {
    return this.#live !== undefined;
  }
  get size(): number {
    return this.#live?.size ?? this.#active.size;
  }
  has(id: string): boolean {
    return (this.#live ?? this.#active).has(id);
  }

  #terminal(task: NativeTask): boolean {
    return ["completed", "failed", "killed", "stopped"].includes(task.status ?? "");
  }
  hint(toolId: string): void {
    this.#hints.add(toolId);
  }
  release(toolId: string, status: string): void {
    this.#hints.delete(toolId);
    const task = this.forTool(toolId);
    if (task) {
      // 前台代理可能只通过 tool_result 收尾，也必须释放活动索引并允许终态水位淘汰。
      task.status = status === "interrupted" ? "stopped" : status;
      task.notified = true;
      const nativeId = this.#tools.get(toolId);
      if (nativeId) this.#active.delete(nativeId);
    }
  }
  forTool(toolId: string): NativeTask | undefined {
    const nativeId = this.#tools.get(toolId);
    const task = nativeId ? this.#tasks.get(nativeId) : undefined;
    return task?.toolId === toolId ? task : undefined;
  }
  nativeId(toolId: string): string | undefined {
    return this.#tools.get(toolId);
  }
  toolId(nativeId: string): string | undefined {
    return this.#tasks.get(nativeId)?.toolId;
  }
  ownsMessage(value: unknown, owns: (id: string) => boolean): boolean {
    const message = record(value);
    const toolId = this.toolId(text(message["task_id"]));
    if (toolId) return owns(toolId);
    return ["parent_tool_use_id", "agent_id", "tool_use_id", "task_id"].some((key) => {
      const id = text(message[key]);
      return !!id && owns(id);
    });
  }
  presentation(
    toolId: string,
    value: unknown,
  ): {
    status: "completed" | "failed" | "interrupted" | undefined;
    summary: string;
  } {
    const message = record(value),
      patch = record(message["patch"]);
    const status = this.forTool(toolId)?.status;
    return {
      status:
        status === "completed" || status === "failed"
          ? status
          : status === "stopped" || status === "killed"
            ? "interrupted"
            : undefined,
      summary:
        text(message["summary"]) ||
        text(patch["error"]) ||
        text(patch["description"]) ||
        text(message["description"]),
    };
  }
  isBackground(toolId: string): boolean {
    const nativeId = this.#tools.get(toolId);
    // 集合只提供仍在后台的正向证据；缺席不能替代完成通知或抹去后台派发身份。
    if (nativeId && this.#live?.has(nativeId)) return true;
    return this.forTool(toolId)?.background ?? this.#hints.has(toolId);
  }
  awaitingNotification(toolId: string): boolean {
    const task = this.forTool(toolId);
    return !!task?.background && !task.notified;
  }

  /** run_id 只按 SDK 保证的字符串顺序比较；缺失时沿用旧 CLI 的 task_id 关联。 */
  #accept(id: string, runId: string): NativeTask | undefined {
    let task = this.#tasks.get(id);
    if (runId && task?.runId && runId < task.runId) return undefined;
    if (!task || (runId && task.runId && runId > task.runId)) {
      if (task?.toolId) this.#tools.delete(task.toolId);
      this.#active.delete(id);
      task = {};
      this.#tasks.set(id, task);
    }
    if (runId) task.runId = runId;
    return task;
  }

  receive(value: unknown): boolean {
    const message = record(value);
    if (message["type"] !== "system") return true;
    const subtype = text(message["subtype"]);
    if (subtype === "background_tasks_changed") {
      const live = new Set<string>();
      for (const value of Array.isArray(message["tasks"]) ? message["tasks"] : []) {
        const entry = record(value),
          id = text(entry["task_id"]);
        if (!id) continue;
        const task = this.#accept(id, text(entry["run_id"]));
        if (task) {
          task.background = true;
          live.add(id);
        } else if (this.#live?.has(id)) {
          // 旧 run 的集合项不能替换当前 run；其他条目仍遵循整集合替换语义。
          live.add(id);
        }
      }
      this.#live = live;
    } else if (
      ["task_started", "task_updated", "task_progress", "task_notification"].includes(subtype)
    ) {
      const id = text(message["task_id"]);
      if (!id) return true;
      const task = this.#accept(id, text(message["run_id"]));
      if (!task) return false;
      const toolId = text(message["tool_use_id"]);
      if (toolId) {
        task.toolId = toolId;
        this.#tools.set(toolId, id);
        this.#hints.delete(toolId);
      }
      if (subtype === "task_notification") {
        task.status = text(message["status"]);
        task.notified = true;
      } else if (!this.#terminal(task)) {
        if (subtype === "task_started")
          task.background = task.background === true || message["is_backgrounded"] !== false;
        if (subtype === "task_updated") {
          const patch = record(message["patch"]);
          if (typeof patch["is_backgrounded"] === "boolean")
            task.background = patch["is_backgrounded"];
          if (typeof patch["status"] === "string") task.status = patch["status"];
        }
      } else return false;
      if (task.background && !this.#terminal(task)) this.#active.add(id);
      else this.#active.delete(id);
    }
    if (this.size > 512) throw new Error("Claude background task capacity exceeded");
    // 保留有限的终态水位以抵御迟到消息；活动任务和仍等待通知的任务不参与淘汰。
    if (this.#tasks.size > 2048) {
      for (const [id, task] of this.#tasks) {
        if (this.has(id) || (task.toolId && !task.notified)) continue;
        this.#tasks.delete(id);
        if (task.toolId && this.#tools.get(task.toolId) === id) this.#tools.delete(task.toolId);
        if (this.#tasks.size <= 2048) break;
      }
    }
    return true;
  }
}
