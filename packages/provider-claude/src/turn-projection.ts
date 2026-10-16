import type { AgentProviderEvent, AgentProviderEventListener } from "@codexly/core";
import type { AgentItem, AgentTurn } from "@codexly/protocol";

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** 只持有当前回合的渲染投影；历史与恢复上下文仍由官方 SDK 的会话文件管理。 */
export class ClaudeTurnProjection {
  readonly #taskId: string;
  readonly #id: string;
  readonly #emit: AgentProviderEventListener;
  readonly #items = new Map<string, AgentItem>();
  readonly #startedAt = new Date().toISOString();
  readonly #blocks = new Map<number, string>();
  #messageId = "";
  #status: AgentTurn["status"] = "running";
  #error: string | null = null;
  #completedAt: string | null = null;
  #textBytes = 0;
  #itemBytes = 0;
  readonly #sizes = new Map<string, number>();

  constructor(taskId: string, id: string, prompt: string, emit: AgentProviderEventListener) {
    this.#taskId = taskId;
    this.#id = id;
    this.#emit = emit;
    this.#items.set(id, { id, type: "message", role: "user", text: prompt });
  }

  get status() {
    return this.#status;
  }
  get id() {
    return this.#id;
  }

  snapshot(): AgentTurn {
    return {
      id: this.#id,
      startedAt: this.#startedAt,
      completedAt: this.#completedAt,
      status: this.#status,
      error: this.#error,
      items: [...this.#items.values()],
    };
  }

  #publish(event: AgentProviderEvent): void {
    this.#emit(event);
  }

  #item(item: AgentItem, completed: boolean, checkBudget = true): void {
    const exists = this.#items.has(item.id);
    const bytes = Buffer.byteLength(JSON.stringify(item));
    const total = this.#itemBytes - (this.#sizes.get(item.id) ?? 0) + bytes;
    if (checkBudget && (total > 1024 * 1024 || this.#items.size > 2048 || bytes > 256 * 1024))
      throw new Error("Claude item exceeds the rendering budget");
    this.#itemBytes = total;
    this.#sizes.set(item.id, bytes);
    this.#items.set(item.id, item);
    if (completed || !exists)
      this.#publish({
        type: completed ? "item.completed" : "item.started",
        taskId: this.#taskId,
        turnId: this.#id,
        itemId: item.id,
        payload: { item },
      });
  }

  #block(block: Record<string, unknown>, id: string, completed: boolean): void {
    if (block["type"] === "text")
      this.#item({ id, type: "message", role: "assistant", text: text(block["text"]) }, completed);
    if (block["type"] === "thinking")
      this.#item(
        { id, type: "reasoning", content: text(block["thinking"]), summary: "" },
        completed,
      );
    if (block["type"] === "tool_use") {
      const toolId = text(block["id"]);
      if (toolId)
        this.#item(
          {
            id: toolId,
            type: "tool",
            name: text(block["name"]) || "Tool",
            input: block["input"] ?? {},
            status: "running",
          },
          false,
        );
    }
  }

  receive(value: unknown): void {
    if (this.#status !== "running") return;
    const message = record(value);
    // 子 Agent 的文本属于它自己的工具结果，不能混入主回复或重复创建用户消息。
    if (message["parent_tool_use_id"] || message["agent_id"]) return;
    if (message["type"] === "stream_event") {
      const event = record(message["event"]);
      const index = typeof event["index"] === "number" ? event["index"] : 0;
      if (event["type"] === "message_start") {
        this.#messageId = text(record(event["message"])["id"]);
        this.#blocks.clear();
      } else if (event["type"] === "content_block_start" && this.#messageId) {
        const block = record(event["content_block"]);
        const id =
          block["type"] === "tool_use" ? text(block["id"]) : `${this.#messageId}:${String(index)}`;
        this.#blocks.set(index, id);
        this.#block(block, id, false);
      } else if (event["type"] === "content_block_delta") {
        const id = this.#blocks.get(index),
          delta = record(event["delta"]);
        const item = id ? this.#items.get(id) : undefined;
        const addition = text(delta["text"] ?? delta["thinking"]);
        if (!id || !item || !addition || (item.type !== "message" && item.type !== "reasoning"))
          return;
        this.#textBytes += Buffer.byteLength(addition);
        if (this.#textBytes > 1024 * 1024)
          throw new Error("Claude turn output exceeds the memory budget");
        this.#items.set(
          id,
          item.type === "message"
            ? { ...item, text: item.text + addition }
            : { ...item, content: item.content + addition },
        );
        if (item.type === "message")
          this.#publish({
            type: "message.delta",
            taskId: this.#taskId,
            turnId: this.#id,
            itemId: id,
            payload: { delta: addition },
          });
        else
          this.#publish({
            type: "reasoning.delta",
            taskId: this.#taskId,
            turnId: this.#id,
            itemId: id,
            payload: { delta: addition, field: "content" },
          });
      }
    } else if (message["type"] === "assistant") {
      const body = record(message["message"]);
      const id = text(body["id"]) || text(message["uuid"]);
      if (!id || !Array.isArray(body["content"])) return;
      body["content"].forEach((block, index) => {
        this.#block(record(block), `${id}:${String(index)}`, true);
      });
    } else if (message["type"] === "user") {
      const content = record(message["message"])["content"];
      if (!Array.isArray(content)) return;
      for (const value of content) {
        const block = record(value),
          id = text(block["tool_use_id"]),
          item = this.#items.get(id);
        if (block["type"] === "tool_result" && item?.type === "tool")
          this.#item(
            {
              ...item,
              output: block["content"],
              status: block["is_error"] === true ? "failed" : "completed",
            },
            true,
          );
      }
    } else if (message["type"] === "result") {
      const success = message["subtype"] === "success" && message["is_error"] !== true;
      // 某些命令只返回 result，没有 assistant；只在没有回复正文时补充，避免重复。
      const result = text(message["result"]);
      if (
        success &&
        result &&
        ![...this.#items.values()].some(
          (item) => item.type === "message" && item.role === "assistant",
        )
      )
        this.#item(
          { id: `${this.#id}:result`, type: "message", role: "assistant", text: result },
          true,
        );
      const errors = Array.isArray(message["errors"])
        ? message["errors"].filter((error): error is string => typeof error === "string").join("\n")
        : "";
      this.finish(
        success ? "completed" : "failed",
        success ? undefined : errors || result || "Claude execution failed",
      );
    }
  }

  finish(status: Exclude<AgentTurn["status"], "running">, error?: string): void {
    if (this.#status !== "running") return;
    for (const item of this.#items.values()) {
      if (item.type === "tool" && item.status === "running")
        this.#item(
          { ...item, status: "failed", output: item.output ?? "Tool ended without a result" },
          true,
          false,
        );
    }
    this.#status = status;
    this.#error = error ?? null;
    this.#completedAt = new Date().toISOString();
    this.#publish({
      type: "turn.completed",
      taskId: this.#taskId,
      turnId: this.#id,
      payload: { turn: this.snapshot() },
    });
  }
}
