import type {
  ContentBlock,
  SessionUpdate,
  StopReason,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk/unstable";
import type { AgentProviderEventListener } from "@codexly/core";
import type { AgentItem, AgentPlan, AgentTurn, AgentMessageAttachment } from "@codexly/protocol";

type TextUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "agent_message_chunk" | "user_message_chunk" | "agent_thought_chunk" }
>;

/** 仅映射 ACP 更新；正文按条目追加，不在每个 token 复制完整历史或写入存储。 */
export class AcpEventProjection {
  readonly #items = new Map<string, AgentItem>();
  readonly #finished = new Set<string>();
  readonly #startedAt = new Date().toISOString();
  #completedAt: string | null = null;
  #status: AgentTurn["status"] = "running";
  #error: string | null = null;
  #anonymous = 0;
  #current: { kind: string; id: string } | undefined;
  plan: AgentPlan | null = null;

  constructor(
    readonly taskId: string,
    readonly turnId: string,
    readonly emit: AgentProviderEventListener,
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
    const delta = contentText(update.content);
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
      ...(update.rawInput !== undefined ? { input: update.rawInput } : {}),
      ...(update.rawOutput !== undefined
        ? { output: update.rawOutput }
        : update.content !== undefined
          ? { output: update.content }
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
      items: structuredClone([...this.#items.values()]),
      forkable: false,
    };
  }

  finish(reason: StopReason): AgentTurn {
    return this.#finish(reason === "cancelled" ? "interrupted" : "completed", null);
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
    this.emit({
      type: "turn.completed",
      taskId: this.taskId,
      turnId: this.turnId,
      payload: { turn },
    });
    return turn;
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
