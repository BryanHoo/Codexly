import {
  ContentBlock,
  SessionUpdate,
  type ToolCallUpdate,
  type ToolCallContent,
  PlanUpdateContent,
} from "@agentclientprotocol/sdk/experimental/v2/unstable";
import type { AgentProviderEventListener } from "@codexly/core";
import type { AgentItem, AgentPlan, AgentTurn, AgentMessageAttachment } from "@codexly/protocol";
import { projectAcpFileChanges } from "./file-changes.js";
import { AcpTurnContent } from "./turn-content.js";
import { acpContextUsage } from "./context-usage.js";

type TextUpdate = Extract<
  SessionUpdate,
  {
    sessionUpdate:
      | "agent_message_chunk"
      | "user_message_chunk"
      | "agent_thought_chunk"
      | "agent_message"
      | "user_message"
      | "agent_thought";
  }
>;

/** 仅映射 ACP 更新；正文按条目追加，不在每个 token 复制完整历史或写入存储。 */
export class AcpEventProjection {
  pendingSteer: Promise<void> | undefined;
  readonly content = new AcpTurnContent();
  readonly #items = new Map<string, AgentItem>();
  readonly #finished = new Set<string>();
  readonly #startedAt = new Date().toISOString();
  #completedAt: string | null = null;
  #status: AgentTurn["status"] = "running";
  #error: string | null = null;
  #stopReason: string | undefined;
  #planId: string | undefined;
  #settlementError: string | undefined;
  #published = false;
  #diffBytes = 0;
  acpMessageId: string | undefined;
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
    this.#emitItem("item.started", item);
  }

  update(update: SessionUpdate): void {
    if (this.#status !== "running") throw new Error("ACP 回合已经结束");
    switch (update.sessionUpdate) {
      case "usage_update":
        this.emit({
          type: "usage.updated",
          taskId: this.taskId,
          turnId: this.turnId,
          payload: {
            usage: acpContextUsage(
              update as Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
            ),
          },
        });
        break;
      case "agent_message":
      case "user_message":
      case "agent_thought":
      case "agent_message_chunk":
      case "user_message_chunk":
      case "agent_thought_chunk":
        this.#text(update as TextUpdate);
        break;
      case "tool_call_update":
        this.#tool(update as ToolCallUpdate);
        break;
      case "tool_call_content_chunk": {
        if (SessionUpdate.isToolCallContentChunk(update))
          this.#fileChanges(`acp:tool:${update.toolCallId}:files`, [update.content], true);
        break;
      }
      case "plan_update": {
        if (!SessionUpdate.isPlanUpdate(update)) break;
        const plan = update.plan;
        if (!PlanUpdateContent.isItems(plan) && !PlanUpdateContent.isMarkdown(plan)) break;
        this.#planId = plan.planId;
        this.plan = PlanUpdateContent.isItems(plan)
          ? {
              explanation: null,
              steps: plan.entries.map((entry) => ({
                text: entry.content,
                status:
                  entry.status === "in_progress" || entry.status === "completed"
                    ? entry.status
                    : "pending",
              })),
            }
          : { explanation: plan.content, steps: [] };
        this.#emitPlan(this.plan);
        break;
      }
      case "plan_removed":
        if (this.#planId === update.planId) {
          this.plan = null;
          this.#planId = undefined;
          this.#emitPlan({ explanation: null, steps: [] });
        }
        break;
      // 配置、命令及会话元数据由 Provider 维护，不伪造成聊天正文。
      default:
        break;
    }
  }

  #emitPlan(plan: AgentPlan): void {
    this.emit({
      type: "plan.updated",
      taskId: this.taskId,
      turnId: this.turnId,
      payload: { plan: structuredClone(plan) },
    });
  }

  #text(update: TextUpdate): void {
    const kind =
      update.sessionUpdate === "agent_thought_chunk" || update.sessionUpdate === "agent_thought"
        ? "thought"
        : update.sessionUpdate === "user_message_chunk" || update.sessionUpdate === "user_message"
          ? "user"
          : "assistant";
    const id = `acp:message:${kind}:${update.messageId}`;
    let item = this.#items.get(id);
    if (!item) {
      item =
        kind === "thought"
          ? { id, type: "reasoning", content: "", summary: "" }
          : { id, type: "message", role: kind === "user" ? "user" : "assistant", text: "" };
      this.#items.set(id, item);
      this.#emitItem("item.started", item);
    }
    // 完整消息按 ID 替换既有正文，后续分块继续追加。空内容也必须清除旧投影。
    const content = update.content;
    if (content === undefined) return;
    if (content === null || Array.isArray(content)) {
      const previous =
        item.type === "message" ? item.text : item.type === "reasoning" ? item.summary : "";
      const text = this.content.replaceText(
        id,
        previous,
        (content ?? []).map(contentText).join(""),
        kind === "thought",
      );
      if (item.type === "message") item = { ...item, text };
      else if (item.type === "reasoning") item = { ...item, summary: text };
      this.#items.set(id, item);
      this.#emitItem("item.started", item);
      return;
    }
    const delta = this.content.text(id, contentText(content), kind === "thought");
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

  #tool(update: ToolCallUpdate): void {
    const id = `acp:tool:${update.toolCallId}`;
    const previous = this.#items.get(id);
    const old = previous?.type === "tool" ? previous : undefined;
    const status =
      update.status === "in_progress"
        ? "running"
        : update.status === "cancelled"
          ? "interrupted"
          : update.status === "paused"
            ? "running"
            : update.status === undefined
              ? (old?.status ?? "pending")
              : update.status === "completed" || update.status === "failed"
                ? update.status
                : "pending";
    const item: AgentItem = {
      id,
      type: "tool",
      name:
        update.title ??
        update.name ??
        (update.title === undefined ? old?.name : undefined) ??
        update.toolCallId,
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
    const completed = status === "completed" || status === "failed" || status === "interrupted";
    this.#emitItem(completed ? "item.completed" : "item.started", item);
    if (completed) this.#finished.add(id);

    if (update.content !== undefined) this.#fileChanges(`${id}:files`, update.content);
  }

  #fileChanges(fileId: string, content: ToolCallContent[] | null, append = false): void {
    const previousFiles = this.#items.get(fileId);
    const oldFiles = previousFiles?.type === "file_change" ? previousFiles : undefined;
    const previousBytes = oldFiles ? Buffer.byteLength(JSON.stringify(oldFiles.changes)) : 0;
    const remaining = 256 * 1024 - this.#diffBytes + previousBytes;
    const projected = projectAcpFileChanges(content, remaining);
    // 结束更新可以只包含文字摘要。已经报告的文件修改要保留到会话历史。
    if (!projected.length) return;
    if (append && oldFiles) {
      // 内容分块追加，完整 content 更新则替换整份工具内容。
      const combined = new Map(oldFiles.changes.map((change) => [change.path, change]));
      for (const change of projected) combined.set(change.path, change);
      projected.splice(0, projected.length, ...combined.values());
    }
    const changes: typeof projected = [];
    let bytesUsed = 1;
    for (const change of projected) {
      const bytes = Buffer.byteLength(JSON.stringify(change)) + 1;
      if (bytesUsed + bytes > remaining) break;
      changes.push(change);
      bytesUsed += bytes;
    }
    if (!changes.length) return;
    this.#diffBytes += bytesUsed - previousBytes;
    // 结构化 diff 已报告发生的更改；工具运行状态继续由独立的工具条目维护。
    const files: AgentItem = { id: fileId, type: "file_change", changes, status: "completed" };
    this.#items.set(fileId, files);
    this.#emitItem("item.completed", files);
    this.#finished.add(fileId);
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

  finish(reason: string): AgentTurn {
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
  if (ContentBlock.isText(content)) return content.text;
  if (ContentBlock.isResourceLink(content)) return `[${content.name}](${content.uri})`;
  if (ContentBlock.isResource(content))
    return "text" in content.resource ? content.resource.text : "[资源]";
  if (ContentBlock.isImage(content)) return "[图片]";
  if (ContentBlock.isAudio(content)) return "[音频]";
  return "";
}
