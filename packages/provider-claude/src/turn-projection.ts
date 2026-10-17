import { createClaudeAgentPreview } from "./subagent-preview.js";
import {
  ClaudeRenderingBuffer,
  previewText,
  CLAUDE_CHILD_PREVIEW_BYTES,
  CLAUDE_PREVIEW_NOTICE,
  CLAUDE_TURN_PREVIEW_BYTES,
} from "./rendering-buffer.js";
import {
  mapClaudeMcpServers,
  mapClaudeUsage,
  mapClaudeResultUsage,
  mapClaudePlan,
  publishClaudePlan,
  publishClaudeMcpServers,
} from "./observability.js";
import type { AgentProviderEventListener } from "@codexly/core";
import type { AgentContextUsage, AgentItem, AgentPlan, AgentTurn } from "@codexly/protocol";
import { createClaudeUserItem, type ClaudeUserInput } from "./turn-input.js";
import type { ClaudeTaskMetadata } from "./history.js";
import { record, text, resultText, displayClaudeMessage } from "./sdk-values.js";
import { ClaudeTaskPlan } from "./task-plan.js";
export { record } from "./sdk-values.js";
/** 只持有当前回合的渲染投影；历史与恢复上下文仍由官方 SDK 的会话文件管理。 */
export class ClaudeTurnProjection {
  readonly #taskId: string;
  readonly #id: string;
  readonly #emit: AgentProviderEventListener;
  readonly #items: ClaudeRenderingBuffer;
  readonly #startedAt = new Date().toISOString();
  readonly #blocks = new Map<number, string>();
  readonly #inputs = new Map<number, { json: string; bytes: number }>();
  readonly #children = new Map<string, ClaudeTurnProjection>();
  readonly #agentTools = new Map<string, string>();
  readonly #backgroundAgents = new Set<string>();
  readonly #taskPlan = new ClaudeTaskPlan();
  #closed = false;
  #lastBlockIndex = 0;
  #model = "";
  contextUsage: AgentContextUsage | null = null;
  plan: AgentPlan | null = null;
  mcpServers: ClaudeTaskMetadata["mcpServers"] = [];
  sessionInitialized = false;
  persistence: AgentTurn["persistence"];
  #requestUsage: Record<string, unknown> = {};
  #messageId = "";
  #status: AgentTurn["status"] = "running";
  #error: string | null = null;
  #completedAt: string | null = null;
  constructor(
    taskId: string,
    id: string,
    prompt: ClaudeUserInput,
    emit: AgentProviderEventListener,
    previewBytes = CLAUDE_TURN_PREVIEW_BYTES,
  ) {
    this.#items = new ClaudeRenderingBuffer(previewBytes, id);
    this.#taskId = taskId;
    this.#id = id;
    this.#emit = emit;
    this.#items.set(createClaudeUserItem(id, prompt));
  }
  get status() {
    return this.#status;
  }
  get hasBackgroundWork(): boolean {
    return [...this.#children.entries()].some(
      ([id, child]) =>
        (this.#backgroundAgents.has(id) && child.status === "running") || child.hasBackgroundWork,
    );
  }
  /** 会话可同时承载多个回合，关联消息必须回到创建工具的投影。 */
  ownsMessage(value: unknown): boolean {
    const message = record(value);
    return ["parent_tool_use_id", "agent_id", "tool_use_id", "task_id"].some((key) => {
      const id = text(message[key]);
      return !!id && !!this.#agentOwner(id);
    });
  }
  restoreMetadata(metadata: ClaudeTaskMetadata | undefined): void {
    if (!metadata) return;
    this.sessionInitialized = metadata.sessionInitialized === true;
    this.contextUsage = metadata.contextUsage;
    this.plan = metadata.plan;
    this.#taskPlan.restore(metadata.planTasks);
    this.mcpServers = metadata.mcpServers;
    this.#model = metadata.model ?? "";
  }
  get id() {
    return this.#id;
  }
  metadata(): ClaudeTaskMetadata {
    return {
      sessionInitialized: this.sessionInitialized,
      contextUsage: this.contextUsage,
      plan: this.plan,
      planTasks: this.#taskPlan.snapshot(),
      model: this.#model || null,
      mcpServers: this.mcpServers,
    };
  }
  snapshot(): AgentTurn {
    return {
      id: this.#id,
      startedAt: this.#startedAt,
      completedAt: this.#completedAt,
      status: this.#status,
      error: this.#error,
      ...(this.persistence ? { persistence: this.persistence } : {}),
      items: this.#items.snapshot(),
    };
  }
  #item(item: AgentItem, completed: boolean): void {
    const exists = this.#items.has(item.id);
    item = this.#items.set(item);
    if (completed || !exists || item.type === "tool")
      this.#emit({
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
      if (toolId) {
        const name = text(block["name"]) || "Tool";
        const previous = this.#items.get(toolId);
        this.#item(
          {
            ...(previous?.type === "tool" ? previous : {}),
            id: toolId,
            type: "tool",
            name: name === "Agent" || name === "Task" ? "agent/spawn" : name,
            input: block["input"] ?? {},
            status: previous?.type === "tool" ? previous.status : "running",
          },
          false,
        );
        if (name === "Agent" || name === "Task") {
          if (record(block["input"])["run_in_background"] === true)
            this.#backgroundAgents.add(toolId);
          this.#agent(toolId);
        }
        if (name === "TodoWrite" && completed) {
          const plan = mapClaudePlan(block["input"]);
          if (plan) this.#taskPlan.restore();
          publishClaudePlan(this, plan, this.#taskId, this.#id, this.#emit);
        }
      }
    }
  }
  /** 子代理仍属于父任务：有界投影随工具保存，不能伪造可独立执行的会话。 */
  #agent(id: string, status?: AgentTurn["status"], summary?: string): void {
    const item = this.#items.get(id);
    if (item?.type !== "tool" || item.name !== "agent/spawn") return;
    const input = record(item.input);
    let child = this.#children.get(id);
    if (!child) {
      // 已回收的终态预览不因重复消息重新建立；活动代理数量不受展示预算限制。
      if (item.status !== "running") return;
      // 原生 ID 只为活动代理或仍可见的摘要保留，避免顺序调用累计关联记录。
      for (const [nativeId, toolId] of this.#agentTools)
        if (!this.#children.has(toolId) && !this.#items.has(toolId))
          this.#agentTools.delete(nativeId);
      child = new ClaudeTurnProjection(
        this.#taskId,
        `${this.#id}:${id}`,
        text(input["prompt"]),
        (event) => {
          // 块完成和任务进度同步正文；不在每个 token 到达时重发整段子代理历史。
          if (!this.#closed && (event.type === "item.completed" || event.type === "item.started"))
            this.#agent(id);
        },
        CLAUDE_CHILD_PREVIEW_BYTES,
      );
      this.#children.set(id, child);
    }
    const prompt = text(input["prompt"]);
    child.#items.set({ id: child.#id, type: "message", role: "user", text: prompt });
    if (
      status &&
      summary &&
      ![...child.#items.values()].some(
        (entry) => entry.type === "message" && entry.role === "assistant",
      )
    )
      child.#item(
        { id: `${child.#id}:result`, type: "message", role: "assistant", text: summary },
        true,
      );
    if (status && status !== "running") child.finish(status, undefined, true);
    this.#item(
      createClaudeAgentPreview(
        item,
        child.snapshot(),
        this.#taskId,
        [...this.#agentTools].find(([, toolId]) => toolId === id)?.[0] ?? null,
        status,
        summary,
      ),
      status !== undefined && status !== "running",
    );
    // 已结束正文已进入有界工具快照；释放可变投影，但不能回收仍有后台后代的树。
    if (child.status !== "running" && !child.hasBackgroundWork) {
      this.#children.delete(id);
      this.#backgroundAgents.delete(id);
    }
  }
  updateContextUsage(usage: AgentContextUsage): void {
    // SDK 暂无统计时可能返回零；保留上次有效用量，但仍接收窗口补全和压缩后的非零统计。
    if (usage.usedTokens === 0 && this.contextUsage && this.contextUsage.usedTokens > 0) {
      usage = { ...usage, usedTokens: this.contextUsage.usedTokens };
    }
    if (
      this.contextUsage?.usedTokens === usage.usedTokens &&
      this.contextUsage.contextWindow === usage.contextWindow
    )
      return;
    this.contextUsage = usage;
    this.#emit({
      type: "usage.updated",
      taskId: this.#taskId,
      turnId: this.#id,
      payload: { usage },
    });
  }
  #usage(value: unknown): void {
    const usage = mapClaudeUsage(value, this.contextUsage?.contextWindow ?? null);
    if (usage) this.updateContextUsage(usage);
  }
  #agentOwner(id: string): ClaudeTurnProjection | undefined {
    const item = this.#items.get(id);
    if (
      this.#children.has(id) ||
      this.#agentTools.has(id) ||
      (item?.type === "tool" && item.name === "agent/spawn")
    )
      return this;
    for (const child of this.#children.values()) {
      const owner = child.#agentOwner(id);
      if (owner) return owner;
    }
    return undefined;
  }
  receive(value: unknown): void {
    if (this.#closed) return;
    const message = displayClaudeMessage(value);
    // 以官方关联字段路由子代理消息，隔离主代理的正文、用量和流式块索引。
    const parentId = text(message["parent_tool_use_id"]),
      agentId = text(message["agent_id"]);
    if (parentId || agentId) {
      const owner = this.#agentOwner(parentId || agentId);
      const parent = parentId || (owner ? owner.#agentTools.get(agentId) : undefined);
      const child = parent && owner ? owner.#children.get(parent) : undefined;
      child?.receive({ ...message, parent_tool_use_id: null, agent_id: undefined });
      return;
    }
    if (message["type"] === "system" && message["subtype"] === "init") {
      this.#model = text(message["model"]) || this.#model;
      this.mcpServers = mapClaudeMcpServers(message["mcp_servers"]);
      publishClaudeMcpServers(this.#taskId, this.mcpServers, this.#emit);
      return;
    }
    if (
      message["type"] === "system" &&
      ["task_started", "task_progress", "task_notification"].includes(text(message["subtype"]))
    ) {
      const nativeId = text(message["task_id"]),
        id = text(message["tool_use_id"]) || this.#agentTools.get(nativeId);
      const owner = this.#agentOwner(text(message["tool_use_id"]) || nativeId);
      if (owner && owner !== this) {
        owner.receive(message);
        return;
      }
      if (!id || !this.#children.has(id)) return;
      this.#agentTools.set(nativeId, id);
      if (message["subtype"] !== "task_notification" && message["is_backgrounded"] !== false)
        this.#backgroundAgents.add(id);
      const status =
        message["subtype"] === "task_notification"
          ? message["status"] === "completed"
            ? "completed"
            : message["status"] === "stopped"
              ? "interrupted"
              : "failed"
          : undefined;
      this.#agent(id, status, text(message["summary"]) || text(message["description"]));
      return;
    }
    if (this.#status !== "running") return;
    if (message["type"] === "stream_event") {
      const event = record(message["event"]);
      const index = typeof event["index"] === "number" ? event["index"] : 0;
      if (event["type"] === "message_start") {
        this.#messageId = text(record(event["message"])["id"]);
        this.#blocks.clear();
        this.#inputs.clear();
        this.#model = text(record(event["message"])["model"]) || this.#model;
        this.#requestUsage = record(record(event["message"])["usage"]);
        this.#usage(this.#requestUsage);
      } else if (event["type"] === "content_block_start" && this.#messageId) {
        const block = record(event["content_block"]);
        const id =
          block["type"] === "tool_use" ? text(block["id"]) : `${this.#messageId}:${String(index)}`;
        this.#blocks.set(index, id);
        this.#lastBlockIndex = index;
        this.#block(block, id, false);
      } else if (event["type"] === "message_delta") {
        this.#requestUsage = { ...this.#requestUsage, ...record(event["usage"]) };
        this.#usage(this.#requestUsage);
      } else if (event["type"] === "content_block_stop") {
        const input = this.#inputs.get(index),
          id = this.#blocks.get(index),
          item = id ? this.#items.get(id) : undefined;
        if (input && item?.type === "tool") {
          // JSON 片段尚未闭合时不解析；完整参数到达后立即刷新运行中的标题。
          const parsed: unknown =
            input.bytes > 256 * 1024 ? { preview: CLAUDE_PREVIEW_NOTICE } : JSON.parse(input.json);
          this.#item({ ...item, input: parsed }, false);
          if (item.name === "agent/spawn") {
            if (record(parsed)["run_in_background"] === true) this.#backgroundAgents.add(item.id);
            this.#agent(item.id);
          }
        }
        this.#inputs.delete(index);
      } else if (event["type"] === "content_block_delta") {
        const id = this.#blocks.get(index),
          delta = record(event["delta"]);
        const item = id ? this.#items.get(id) : undefined;
        if (item?.type === "tool" && delta["type"] === "input_json_delta") {
          const chunk = text(delta["partial_json"]),
            input = this.#inputs.get(index) ?? { json: "", bytes: 0 };
          input.bytes += Buffer.byteLength(chunk);
          input.json = input.bytes > 256 * 1024 ? "" : input.json + chunk;
          this.#inputs.set(index, input);
          return;
        }
        const addition = text(delta["text"] ?? delta["thinking"]);
        if (!id || !item || !addition || (item.type !== "message" && item.type !== "reasoning"))
          return;
        const update = this.#items.appendText(id, addition);
        if (!update) return;
        if (update.delta === null) {
          this.#emit({
            type: "item.started",
            taskId: this.#taskId,
            turnId: this.#id,
            itemId: id,
            payload: { item: update.item },
          });
          return;
        }
        if (item.type === "message")
          this.#emit({
            type: "message.delta",
            taskId: this.#taskId,
            turnId: this.#id,
            itemId: id,
            payload: { delta: addition },
          });
        else
          this.#emit({
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
      this.#model = text(body["model"]) || this.#model;
      this.#usage(body["usage"]);
      if (!id || !Array.isArray(body["content"])) return;
      const content = body["content"];
      content.forEach((block, index) => {
        const blockIndex =
          content.length === 1 && id === this.#messageId ? this.#lastBlockIndex : index;
        this.#block(record(block), `${id}:${String(blockIndex)}`, true);
      });
    } else if (message["type"] === "user") {
      const content = record(message["message"])["content"];
      if (!Array.isArray(content)) return;
      for (const value of content) {
        const block = record(value),
          id = text(block["tool_use_id"]),
          item = this.#items.get(id);
        if (block["type"] === "tool_result" && item?.type === "tool") {
          // 仅在工具成功返回后更新计划，按 tool_use_id 配对，避免失败/重复结果污染状态。
          if (item.status === "running" && block["is_error"] !== true) {
            const plan = this.#taskPlan.apply(item.name, item.input, message["tool_use_result"]);
            publishClaudePlan(this, plan, this.#taskId, this.#id, this.#emit);
          }
          if (item.name === "agent/spawn") {
            const result = record(message["tool_use_result"]);
            if (result["isAsync"] === true || record(item.input)["run_in_background"] === true)
              this.#backgroundAgents.add(id);
            // 后台启动的 tool_result 只代表已派发，真正终态由 task_notification 决定。
            if (result["isAsync"] !== true && record(item.input)["run_in_background"] !== true)
              this.#agent(
                id,
                block["is_error"] === true ? "failed" : "completed",
                resultText(block["content"]) || undefined,
              );
            continue;
          }
          this.#item(
            {
              ...item,
              output: block["content"],
              status: block["is_error"] === true ? "failed" : "completed",
            },
            true,
          );
        }
      }
    } else if (message["type"] === "result") {
      const usage = mapClaudeResultUsage(message, this.#model, this.contextUsage);
      if (usage) this.updateContextUsage(usage);
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
        true,
      );
    }
  }

  /** 会话终止与父回合结束分开；已完成的父回合仍需清理尚在运行的后代。 */
  close(status: "failed" | "interrupted", error?: string): void {
    if (this.#closed) return;
    this.finish(status, error);
    this.#closed = true;
    for (const [id, child] of this.#children) {
      child.close(status, error);
      this.#agent(id, child.status);
    }
  }

  finish(
    status: Exclude<AgentTurn["status"], "running">,
    error?: string,
    preserveBackground = false,
  ): void {
    if (this.#status !== "running") return;
    // 先提交终态，阻断子代理收尾通知重入父级结束路径。
    this.#status = status;
    this.#error = error ? previewText(error, 8192) : null;
    this.#completedAt = new Date().toISOString();
    for (const item of [...this.#items.values()]) {
      if (item.type === "tool" && item.name === "agent/spawn" && item.status === "running") {
        if (
          preserveBackground &&
          (this.#backgroundAgents.has(item.id) || this.#children.get(item.id)?.hasBackgroundWork)
        )
          continue;
        this.#agent(item.id, status === "interrupted" ? "interrupted" : "failed");
        continue;
      }
      if (item.type === "tool" && item.status === "running")
        this.#item(
          { ...item, status: "failed", output: item.output ?? "Tool ended without a result" },
          true,
        );
    }
    this.#emit({
      type: "turn.completed",
      taskId: this.#taskId,
      turnId: this.#id,
      payload: { turn: this.snapshot() },
    });
  }
}
