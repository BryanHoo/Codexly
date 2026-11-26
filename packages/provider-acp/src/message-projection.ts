import type { ContentBlock, SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import type { AgentProviderEventListener } from "@codexly/core";
import type { AgentItem, AgentMessageAttachment } from "@codexly/protocol";
import type { AcpTurnContent } from "./turn-content.js";

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
export type MediaReferences = ReadonlyMap<ContentBlock, AgentMessageAttachment>;
type MessageItem = Extract<AgentItem, { type: "message" }>;

export class AcpMessageProjection {
  readonly #messageGroups = new Map<string, { index: number; kind: string }>();

  constructor(
    private readonly taskId: string,
    private readonly turnId: string,
    private readonly content: AcpTurnContent,
    private readonly items: Map<string, AgentItem>,
    private readonly emit: AgentProviderEventListener,
    private readonly emitItem: (type: "item.started", item: AgentItem) => void,
  ) {}

  text(update: TextUpdate, scope: string, media?: MediaReferences): void {
    const kind =
      update.sessionUpdate === "agent_thought_chunk"
        ? "thought"
        : update.sessionUpdate === "user_message_chunk"
          ? "user"
          : "assistant";
    // 缺少原生消息 ID 的连续分块只在自己的会话内归组。
    const group = this.#messageGroups.get(scope) ?? { index: 0, kind: "" };
    if (group.kind !== kind) {
      group.kind = kind;
      group.index++;
      this.#messageGroups.set(scope, group);
    }
    const id = `${scope}acp:message:${kind}:${update.messageId ?? `local-${String(group.index)}`}`;
    const previous = this.items.get(id);
    const item =
      previous ??
      (kind === "thought"
        ? { id, type: "reasoning", content: "", summary: "" }
        : {
            id,
            type: "message",
            role: kind === "user" && !scope ? "user" : "assistant",
            text: "",
          });
    const content = update.content;
    const attachment = media?.get(content);
    if (attachment && item.type === "message") {
      if (!scope) this.content.markMedia(id, item.text.length, contentText(content));
      this.#appendAttachment(item, attachment);
      return;
    }
    if (!previous) {
      this.items.set(id, item);
      this.emitItem("item.started", item);
    }
    const delta = this.content.text(id, contentText(content), kind === "thought");
    if (!delta) return;
    if (item.type === "reasoning") {
      // ACP 主动公开的 thought 属于可展示摘要；旧 content 字段不参与两端展示。
      this.items.set(id, { ...item, summary: item.summary + delta });
      this.emit({
        type: "reasoning.delta",
        taskId: this.taskId,
        turnId: this.turnId,
        itemId: id,
        payload: { delta, field: "summary" },
      });
    } else if (item.type === "message") {
      this.items.set(id, { ...item, text: item.text + delta });
      this.emit({
        type: "message.delta",
        taskId: this.taskId,
        turnId: this.turnId,
        itemId: id,
        payload: { delta },
      });
    }
  }

  sessionMessage(
    update: Extract<SessionUpdate, { sessionUpdate: "session_message" | "session_message_chunk" }>,
    scope: string,
    media?: MediaReferences,
  ): void {
    if (update.content === undefined) return;
    const id = `${scope}acp:delegation:${update.messageId}`;
    const old = this.items.get(id);
    const item =
      old?.type === "message"
        ? old
        : {
            id,
            type: "message" as const,
            role: "assistant" as const,
            phase: "commentary" as const,
            text: "",
          };
    if (update.sessionUpdate === "session_message") {
      const attachments = [
        ...new Map(
          [...(media?.values() ?? [])].map((attachment) => [attachment.id, attachment]),
        ).values(),
      ];
      const text = this.content.replaceText(
        id,
        item.text,
        (update.content ?? [])
          .filter((block) => !media?.has(block))
          .map(contentText)
          .join("\n"),
        false,
      );
      // 完整消息替换旧分块及引用，避免被撤回的媒体继续显示。
      const { attachments: _previousAttachments, ...body } = item;
      const next = { ...body, text, ...(attachments.length ? { attachments } : {}) };
      this.items.set(id, next);
      this.emitItem("item.started", next);
      return;
    }
    const attachment = media?.get(update.content);
    if (attachment) {
      this.#appendAttachment(item, attachment);
      return;
    }
    if (!old) {
      this.items.set(id, item);
      this.emitItem("item.started", item);
    }
    const delta = this.content.text(id, contentText(update.content), false);
    if (!delta) return;
    this.items.set(id, { ...item, text: item.text + delta });
    this.emit({
      type: "message.delta",
      taskId: this.taskId,
      turnId: this.turnId,
      itemId: id,
      payload: { delta },
    });
  }

  #appendAttachment(item: MessageItem, attachment: AgentMessageAttachment): void {
    if (item.attachments?.some(({ id }) => id === attachment.id)) return;
    const next = { ...item, attachments: [...(item.attachments ?? []), attachment] };
    this.items.set(item.id, next);
    // 沿用消息条目的原位更新，传输数据仅包含附件元数据。
    this.emitItem("item.started", next);
  }
}

export function mediaInput(block: ContentBlock) {
  if (block.type === "audio") {
    const subtype = /^audio\/([a-z0-9][a-z0-9.+-]{0,40})$/iu
      .exec(block.mimeType)?.[1]
      ?.toLowerCase();
    const extension = subtype === "mpeg" ? "mp3" : subtype === "x-wav" ? "wav" : subtype;
    return {
      image: false,
      encoded: block.data,
      mediaType: subtype ? `audio/${subtype}` : "application/octet-stream",
      name: extension ? `音频.${extension}` : "音频",
    };
  }
  const image = block.type === "image";
  const resource = block.type === "resource" ? block.resource : undefined;
  const encoded = image ? block.data : resource && "blob" in resource ? resource.blob : undefined;
  if (typeof encoded !== "string") return undefined;
  // URI 只用于取文件名。二进制及不支持预览的图片使用通用下载类型。
  const uri = image ? block.uri : resource?.uri;
  const path = uri?.split(/[?#]/u, 1)[0];
  const filename = path?.slice(path.lastIndexOf("/") + 1).trim();
  const imageExtension = image && /^image\/(png|jpeg|gif|webp)$/iu.exec(block.mimeType)?.[1];
  const name =
    (filename === "" ? undefined : filename) ??
    (imageExtension ? `图片.${imageExtension}` : image ? "图片" : "资源");
  return { image, encoded, name, mediaType: "application/octet-stream" };
}

export function contentText(content: ContentBlock): string {
  if (content.type === "text") return content.text;
  if (content.type === "resource_link") return `[${content.name}](${content.uri})`;
  if (content.type === "resource")
    return "text" in content.resource ? content.resource.text : "[资源]";
  if (content.type === "image") return "[图片]";
  return "[音频]";
}
