import type { AgentPlan, AgentPlanStepStatus } from "@codexly/protocol";
import { previewText } from "./rendering-buffer.js";
import { record, text } from "./sdk-values.js";

// 新旧任务工具共享展示预算，避免计划事件或持久化元数据随模型参数无限增长。
export const CLAUDE_PLAN_MAX_TASKS = 128;
export const CLAUDE_PLAN_TITLE_BYTES = 512;

export interface ClaudePlanTask {
  id: string;
  subject: string;
  status: AgentPlanStepStatus;
}

/** 原生任务 ID 与工具调用 ID 不同；持久保存前者，供后续回合继续更新同一计划。 */
export class ClaudeTaskPlan {
  readonly #tasks = new Map<string, ClaudePlanTask>();
  readonly #pending = new Map<string, AgentPlan>();

  /** 参数生成只暂存有界计划，不提交；参数仍取原始块，避免受展示缓存裁剪影响。 */
  stage(id: string, plan: AgentPlan | undefined): void {
    if (plan) this.#pending.set(id, plan);
  }

  clearPending(): void {
    this.#pending.clear();
  }

  restore(tasks: readonly ClaudePlanTask[] = []): void {
    this.#tasks.clear();
    for (const task of tasks.slice(0, CLAUDE_PLAN_MAX_TASKS)) this.#put(task);
  }

  snapshot(): ClaudePlanTask[] {
    return [...this.#tasks.values()].map((task) => ({ ...task }));
  }

  #put(value: unknown): boolean {
    const task = record(value),
      id = text(task["id"]),
      subject = text(task["subject"]),
      status = task["status"];
    if (
      !id ||
      id.length > 256 ||
      !subject ||
      !["pending", "in_progress", "completed"].includes(text(status))
    )
      return false;
    // 计划仅是有界 UI 投影；超限不影响官方工具执行，也不让元数据无限增长。
    if (!this.#tasks.has(id) && this.#tasks.size >= CLAUDE_PLAN_MAX_TASKS) return false;
    this.#tasks.set(id, {
      id,
      subject: previewText(subject, CLAUDE_PLAN_TITLE_BYTES),
      status: status as AgentPlanStepStatus,
    });
    return true;
  }

  apply(
    tool: { id: string; name: string; input?: unknown; status: string },
    rawResult: unknown,
    resultBlock: Record<string, unknown>,
  ): AgentPlan | undefined {
    if (tool.status !== "running") return undefined;
    const { id: toolId, name, input: rawInput } = tool;
    const failed = resultBlock["is_error"] === true;
    if (name === "TodoWrite") {
      const plan = this.#pending.get(toolId);
      // 成功和失败都消费待提交记录；只有成功替换计划时才清除原生任务索引。
      this.#pending.delete(toolId);
      if (failed || !plan) return undefined;
      this.#tasks.clear();
      return plan;
    }
    if (failed) return undefined;
    const input = record(rawInput),
      result = record(rawResult);
    let changed = false;
    if (name === "TaskCreate") {
      const task = record(result["task"]);
      changed = this.#put({
        id: task["id"],
        subject: task["subject"] ?? input["subject"],
        status: "pending",
      });
    } else if (name === "TaskUpdate" && result["success"] === true) {
      // SDK 会修复模型传来的 id/task_id 别名；结果中的规范 ID 优先于原始输入。
      const id = text(result["taskId"]) || text(input["taskId"] ?? input["id"] ?? input["task_id"]);
      const previous = this.#tasks.get(id);
      const status = record(result["statusChange"])["to"] ?? input["status"];
      if (status === "deleted") changed = this.#tasks.delete(id);
      else if (previous)
        changed = this.#put({
          ...previous,
          subject: input["subject"] ?? previous.subject,
          status: status ?? previous.status,
        });
    } else if (name === "TaskGet") {
      changed = this.#put(result["task"]);
    } else if (name === "TaskList" && Array.isArray(result["tasks"])) {
      this.#tasks.clear();
      for (const task of result["tasks"].slice(0, CLAUDE_PLAN_MAX_TASKS)) this.#put(task);
      changed = true;
    }
    if (!changed) return undefined;
    return {
      explanation: null,
      steps: [...this.#tasks.values()].map(({ subject, status }) => ({ text: subject, status })),
    };
  }
}
