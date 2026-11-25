import type {
  ContentBlock,
  SessionUpdate,
  ToolCallUpdate,
  ToolCallContent,
} from "@agentclientprotocol/sdk/unstable";
import type { AgentProviderEventListener } from "@codexly/core";
import {
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGES,
  type AgentItem,
  type AgentPlan,
  type AgentTurn,
  type AgentMessageAttachment,
} from "@codexly/protocol";
import type { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import { projectAcpFileChanges } from "./file-changes.js";
import { AcpTurnContent } from "./turn-content.js";
import { acpContextUsage } from "./context-usage.js";
import type { AcpSubagentItem } from "./subagent-sessions.js";
import {
  AcpMessageProjection,
  contentText,
  mediaInput,
  type MediaReferences,
} from "./message-projection.js";

type CompactionUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "compaction_update" | "compaction_summary_chunk" }
>;

/** 仅映射 ACP 更新；正文按条目追加，不在每个 token 复制完整历史或写入存储。 */
export class AcpEventProjection {
  pendingSteer: Promise<void> | undefined;
  pendingMedia: Promise<void> | undefined;
  readonly content = new AcpTurnContent();
  readonly #items = new Map<string, AgentItem>();
  readonly #messages: AcpMessageProjection;
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
  #mediaCount = 0;
  #mediaBytes = 0;
  #attachments: HistoricalTaskAttachments | undefined;
  acpMessageId: string | undefined;
  plan: AgentPlan | null = null;

  constructor(
    readonly taskId: string,
    readonly turnId: string,
    readonly emit: AgentProviderEventListener,
    private readonly deferCompletion = false,
    private readonly attachmentStore?: () => HistoricalTaskAttachments,
  ) {
    this.#messages = new AcpMessageProjection(
      this.taskId,
      this.turnId,
      this.content,
      this.#items,
      this.emit,
      (type, item) => {
        this.#emitItem(type, item);
      },
    );
  }

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

  announceSubagent(item: AcpSubagentItem): void {
    const previous = this.#items.get(item.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(item)) return;
    this.#items.set(item.id, item);
    this.#emitItem("item.started", item);
  }

  /** 在 ACP 通知顺序内保存媒体，后续正文及回合完成事件才能看到同一份引用。 */
  ingest(update: SessionUpdate, subagent?: AcpSubagentItem): void | Promise<void> {
    if (!this.running) return;
    const kind = update.sessionUpdate;
    const block =
      kind === "agent_message_chunk" ||
      kind === "user_message_chunk" ||
      kind === "session_message_chunk"
        ? update.content
        : undefined;
    const blocks =
      kind === "session_message"
        ? update.content
        : block && block.type !== "text" && block.type !== "resource_link"
          ? [block]
          : undefined;
    if (!blocks?.length || !this.attachmentStore) {
      this.update(update, subagent);
      return;
    }
    const pending = this.#ingestMedia(update, subagent, blocks, this.attachmentStore).finally(
      () => {
        if (this.pendingMedia === pending) this.pendingMedia = undefined;
      },
    );
    this.pendingMedia = pending;
    return pending;
  }

  async #ingestMedia(
    update: SessionUpdate,
    subagent: AcpSubagentItem | undefined,
    blocks: readonly ContentBlock[],
    store: () => HistoricalTaskAttachments,
  ): Promise<void> {
    let media: Map<ContentBlock, AgentMessageAttachment> | undefined;
    for (const block of blocks) {
      const input = mediaInput(block);
      if (!input || this.#mediaCount >= MAX_AGENT_IMAGES) continue;
      const padding = input.encoded.endsWith("==") ? 2 : input.encoded.endsWith("=") ? 1 : 0;
      const size = Math.floor((input.encoded.length * 3) / 4) - padding;
      if (size <= 0 || size > MAX_AGENT_FILE_TOTAL_BYTES - this.#mediaBytes) continue;
      // 限制每回合的解码次数和总字节，包括无效块，避免异常 Agent 反复占用 Worker。
      this.#mediaCount++;
      this.#mediaBytes += size;
      this.#attachments ??= store();
      const attachment = await this.#attachments
        .addBase64(this.taskId, input)
        .catch(() => undefined);
      if (!this.running) return;
      if (attachment) (media ??= new Map()).set(block, attachment);
    }
    if (this.running) this.update(update, subagent, media);
  }

  update(update: SessionUpdate, subagent?: AcpSubagentItem, media?: MediaReferences) {
    if (this.#status !== "running") throw new Error("ACP 回合已经结束");
    const scope = subagent?.id ?? "";
    if (subagent && !this.#items.has(scope)) this.announceSubagent(subagent);
    switch (update.sessionUpdate) {
      case "compaction_update":
      case "compaction_summary_chunk":
        this.#compaction(update, scope);
        break;
      case "usage_update": {
        if (subagent) break;
        // ACP 的 used 是上下文占用。仅采信命名空间内、明确按当前回合累计的输出计数。
        const outputTokens = update._meta?.["codexly.dev/turnOutputTokens"];
        this.emit({
          type: "usage.updated",
          taskId: this.taskId,
          turnId: this.turnId,
          payload: {
            usage: acpContextUsage(update),
            ...(typeof outputTokens === "number" &&
            Number.isSafeInteger(outputTokens) &&
            outputTokens >= 0
              ? { outputTokens }
              : {}),
          },
        });
        break;
      }
      case "agent_message_chunk":
      case "user_message_chunk":
      case "agent_thought_chunk":
        this.#messages.text(update, scope, media);
        break;
      case "tool_call":
      case "tool_call_update":
        return this.#tool(update, scope);
      case "session_message":
      case "session_message_chunk":
        this.#messages.sessionMessage(update, scope, media);
        break;
      case "plan":
        if (subagent) {
          const id = scope + "acp:plan";
          const symbols = { pending: "○", in_progress: "◐", completed: "✓" };
          const text = update.entries
            .map(({ status, content }) => symbols[status] + " " + content)
            .join("\n");
          const item = { id, type: "plan" as const, text: text.slice(0, 16_384) };
          this.#items.set(id, item);
          this.#emitItem("item.started", item);
          break;
        }
        this.plan = {
          explanation: null,
          steps: update.entries.map((entry) => ({ text: entry.content, status: entry.status })),
        };
        this.#emitPlan(this.plan);
        break;
      case "plan_update": {
        if (subagent) break;
        const plan = update.plan;
        this.#planId = plan.planId;
        this.plan =
          plan.type === "items"
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
        if (subagent) break;
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

  #compaction(update: CompactionUpdate, scope: string): void {
    const id = `${scope}acp:compaction:${update.compactionId}`;
    const previous = this.#items.get(id);
    const old = previous?.type === "compaction" ? previous : undefined;
    const item: Extract<AgentItem, { type: "compaction" }> = old ?? {
      id,
      type: "compaction",
      status: "in_progress",
    };
    if (update.sessionUpdate === "compaction_summary_chunk") {
      // 先固定时间线位置，再发有界文本增量。关闭的详情无需解析每个分块。
      if (!old) {
        this.#items.set(id, item);
        this.#emitItem("item.started", item);
      }
      const delta = this.content.compactionSummary(id, contentText(update.content));
      if (!delta) return;
      this.#items.set(id, { ...item, summary: (item.summary ?? "") + delta });
      this.emit({
        type: "compaction.summary_delta",
        taskId: this.taskId,
        turnId: this.turnId,
        itemId: id,
        payload: { delta },
      });
      return;
    }
    const { error, summary } = update;
    let nextSummary = item.summary;
    // v1 的可选字段省略时保留，null 清空。完整摘要覆盖已经收到的分块。
    if (summary !== undefined) {
      this.content.resetCompactionSummary(id, item.summary ?? "");
      nextSummary = "";
      for (const block of summary ?? []) {
        nextSummary += this.content.compactionSummary(id, contentText(block));
      }
    }
    const nextError = error === undefined ? item.error : (error?.slice(0, 8_192) ?? null);
    const next = {
      id,
      type: "compaction" as const,
      status: update.status,
      ...(nextSummary === undefined ? {} : { summary: nextSummary }),
      ...(nextError === undefined ? {} : { error: nextError }),
    };
    this.#items.set(id, next);
    const terminal = ["completed", "failed", "cancelled"].includes(next.status);
    if (terminal) this.#finished.add(id);
    this.#emitItem(terminal ? "item.completed" : "item.started", next);
  }

  #emitPlan(plan: AgentPlan): void {
    this.emit({
      type: "plan.updated",
      taskId: this.taskId,
      turnId: this.turnId,
      payload: { plan: structuredClone(plan) },
    });
  }

  #tool(update: ToolCallUpdate, scope: string) {
    const id = `${scope}acp:tool:${update.toolCallId}`;
    const previous = this.#items.get(id);
    const old = previous?.type === "tool" ? previous : undefined;
    const status =
      update.status === "in_progress"
        ? "running"
        : update.status == null
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
    return item;
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
        item.type === "tool" &&
        !id.startsWith("acp:child:") &&
        (item.status === "pending" || item.status === "running")
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
