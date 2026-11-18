import type {
  ContentBlock,
  SessionUpdate,
  StopReason,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk/unstable";
import type { AgentProviderEventListener } from "@codexly/core";
import type { AgentItem, AgentPlan, AgentTurn, AgentMessageAttachment } from "@codexly/protocol";
import { AcpTurnContent } from "./turn-content.js";

type TextUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "agent_message_chunk" | "user_message_chunk" | "agent_thought_chunk" }
>;

/** 仅映射 ACP 更新；正文按条目追加，不在每个 token 复制完整历史或写入存储。 */
export class AcpEventProjection {
  readonly content = new AcpTurnContent();
  readonly #items = new Map<string, AgentItem>();
  readonly #finished = new Set<string>();
  readonly #startedAt = new Date().toISOString();
  #completedAt: string | null = null;
  #status: AgentTurn["status"] = "running";
  #error: string | null = null;
  #stopReason: StopReason | undefined;
  #anonymous = 0;
  #current: { kind: string; id: string } | undefined;
  #settlementError: string | undefined;
  #published = false;
  plan: AgentPlan | null = null;

  constructor(
    readonly taskId: string,
    readonly turnId: string,
    readonly emit: AgentProviderEventListener,
    private readonly deferCompletion = false,
  ) {}

  /** 状态检查不构造整份回合快照，避免审批和退订复制历史正文。 */
  get running(): boolean {
    return this.#status === "running";
  }

  userMessage(id: string, text: string, attachments: AgentMessageAttachment[]): void {
    const item: AgentItem = {
      id,
      type: "message",
      role: "user",
      text,
      ...(attachments.length ? { attachments } : {}),
    };
    this.#items.set(id, item);
    this.#current = { kind: "user", id };
    this.#emitItem("item.started", item);
  }

  update(update: SessionUpdate): void {
    if (this.#status !== "running") throw new Error("ACP 回合已经结束");
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "user_message_chunk":
      case "agent_thought_chunk":
        this.#text(update);
        break;
      case "tool_call":
      case "tool_call_update":
        this.#current = undefined;
        this.#tool(update);
        break;
      case "plan": {
        this.plan = {
          explanation: null,
          steps: update.entries.map((entry) => ({ text: entry.content, status: entry.status })),
        };
        this.emit({
          type: "plan.updated",
          taskId: this.taskId,
          turnId: this.turnId,
          payload: { plan: structuredClone(this.plan) },
        });
        break;
      }
      // 配置、命令及会话元数据由 Provider 维护，不伪造成聊天正文。
      default:
        break;
    }
  }

  #text(update: TextUpdate): void {
    const kind =
      update.sessionUpdate === "agent_thought_chunk"
        ? "thought"
        : update.sessionUpdate === "user_message_chunk"
          ? "user"
          : "assistant";
    const id = update.messageId
      ? `acp:message:${kind}:${update.messageId}`
      : this.#current?.kind === kind
        ? this.#current.id
        : `acp:message:${kind}:anonymous-${String(++this.#anonymous)}`;
    this.#current = { kind, id };
    let item = this.#items.get(id);
    if (!item) {
      item =
        kind === "thought"
          ? { id, type: "reasoning", content: "", summary: "" }
          : { id, type: "message", role: kind === "user" ? "user" : "assistant", text: "" };
      this.#items.set(id, item);
      this.#emitItem("item.started", item);
    }
    const delta = this.content.text(id, contentText(update.content), kind === "thought");
    if (!delta) return;
    if (item.type === "reasoning") {
      // ACP 主动公开的 thought 属于可展示摘要；旧 content 字段不参与两端展示。
      this.#items.set(id, { ...item, summary: item.summary + delta });
      this.emit({
        type: "reasoning.delta",
        taskId: this.taskId,
        turnId: this.turnId,
        itemId: id,
        payload: { delta, field: "summary" },
      });
    } else if (item.type === "message") {
      this.#items.set(id, { ...item, text: item.text + delta });
      this.emit({
        type: "message.delta",
        taskId: this.taskId,
        turnId: this.turnId,
        itemId: id,
        payload: { delta },
      });
    }
  }

  #tool(update: ToolCall | ToolCallUpdate): void {
    const id = `acp:tool:${update.toolCallId}`;
    const previous = this.#items.get(id);
    const old = previous?.type === "tool" ? previous : undefined;
    const status =
      update.status === "in_progress" ? "running" : (update.status ?? old?.status ?? "pending");
    const item: AgentItem = {
      id,
      type: "tool",
      name: update.title ?? old?.name ?? update.toolCallId,
      status,
      ...(old && "input" in old ? { input: old.input } : {}),
      ...(old && "output" in old ? { output: old.output } : {}),
      ...(update.rawInput !== undefined
        ? { input: this.content.tool(id, "input", update.rawInput, old?.input) }
        : {}),
      ...(update.rawOutput !== undefined
        ? { output: this.content.tool(id, "output", update.rawOutput, old?.output) }
        : update.content !== undefined
          ? { output: this.content.tool(id, "output", update.content, old?.output) }
          : {}),
    };
    this.#items.set(id, item);
    const completed = status === "completed" || status === "failed";
    this.#emitItem(completed ? "item.completed" : "item.started", item);
    if (completed) this.#finished.add(id);
  }

  snapshot(): AgentTurn {
    return {
      id: this.turnId,
      startedAt: this.#startedAt,
      completedAt: this.#completedAt,
      status: this.#status,
      error: this.#error,
      ...(this.#stopReason ? { stopReason: this.#stopReason } : {}),
      items: structuredClone([...this.#items.values()]),
      forkable: false,
    };
  }

  /** 保存中的快照不抢先报告终态；失败时仍保留当前已显示的内容。 */
  visibleSnapshot(): AgentTurn {
    const turn = this.snapshot();
    if (this.#settlementError) return { ...turn, status: "failed", error: this.#settlementError };
    return this.deferCompletion && !this.#published
      ? { ...turn, status: "running", completedAt: null, error: null }
      : turn;
  }

  storageFailed(message: string): void {
    this.#settlementError = message;
    this.emit({
      type: "provider.error",
      taskId: this.taskId,
      turnId: this.turnId,
      payload: { code: "internal_error", message, willRetry: false },
    });
  }

  finish(reason: StopReason): AgentTurn {
    if (!this.running) return this.snapshot();
    this.#stopReason = reason;
    // 拒绝也是可展示的完整答复；取消及配额截断保留部分正文并显示中断。
    // 这里仅决定聊天状态，不能据此判断辅助生成是否成功。
    const status = reason === "end_turn" || reason === "refusal" ? "completed" : "interrupted";
    return this.#finish(status, null);
  }

  fail(error: string): AgentTurn {
    return this.#finish("failed", error);
  }

  #finish(status: AgentTurn["status"], error: string | null): AgentTurn {
    if (this.#status !== "running") return this.snapshot();
    this.#status = status;
    this.#error = error;
    this.#completedAt = new Date().toISOString();
    for (const [id, item] of this.#items) {
      if (this.#finished.has(id)) continue;
      // 未收到工具完成确认时不能伪造成功；取消保留部分输出及中断状态。
      const final =
        item.type === "tool" && (item.status === "pending" || item.status === "running")
          ? {
              ...item,
              status: status === "interrupted" ? ("interrupted" as const) : ("failed" as const),
            }
          : item;
      this.#items.set(id, final);
      this.#emitItem("item.completed", final);
      this.#finished.add(id);
    }
    const turn = this.snapshot();
    if (!this.deferCompletion) this.publishCompletion(turn);
    return turn;
  }

  publishCompletion(turn: AgentTurn): void {
    if (this.#published) return;
    this.#published = true;
    this.#settlementError = undefined;
    this.emit({
      type: "turn.completed",
      taskId: this.taskId,
      turnId: this.turnId,
      payload: { turn },
    });
  }

  #emitItem(type: "item.started" | "item.completed", item: AgentItem): void {
    this.emit({
      type,
      taskId: this.taskId,
      turnId: this.turnId,
      itemId: item.id,
      payload: { item: structuredClone(item) },
    });
  }
}

export function contentText(content: ContentBlock): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "resource_link":
      return `[${content.name}](${content.uri})`;
    case "resource":
      return "text" in content.resource ? content.resource.text : "[资源]";
    case "image":
      return "[图片]";
    case "audio":
      return "[音频]";
  }
}
