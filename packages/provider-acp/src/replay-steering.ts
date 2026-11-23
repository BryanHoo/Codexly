import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import type { ReadableStreamReadResult } from "node:stream/web";
import type { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import {
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_TEXT_BYTES,
  type AgentItem,
} from "@codexly/protocol";
import { contentText, mediaInput } from "./message-projection.js";

type UserMessage = Extract<AgentItem, { type: "message" }>;
type UserUpdate = Extract<SessionUpdate, { sessionUpdate: "user_message_chunk" }>;

export function userUpdate(update: SessionUpdate): UserUpdate | undefined {
  if (update.sessionUpdate === "user_message_chunk") return update;
  return undefined;
}

export async function matchesSteering(
  echoed: string,
  message: UserMessage,
  storage: HistoricalTaskAttachments,
  taskId: string,
): Promise<boolean> {
  if (echoed && echoed === message.text) return true;
  if (!echoed.startsWith(message.text)) return false;
  let rest = echoed.slice(message.text.length);
  const attachments = message.attachments ?? [];
  // 按提交顺序核对附件展开后的正文。Codex 会将文件引用回放成带 @ 的 Markdown 链接。
  for (const attachment of attachments) {
    if (attachment.kind !== "text") continue;
    const stored = await storage.read(taskId, attachment.id);
    if (!stored) return false;
    const text = attachment.name + "\n" + new TextDecoder().decode(stored.content);
    if (!rest.startsWith(text)) return false;
    rest = rest.slice(text.length);
  }
  for (const { kind, name } of attachments) {
    if (kind === "text") continue;
    if (kind === "image" && rest.startsWith("[图片]")) {
      rest = rest.slice("[图片]".length);
      continue;
    }
    const prefix = [`[${name}](file://`, `[@${name}](file://`].find((link) =>
      rest.startsWith(link),
    );
    const end = prefix === undefined ? -1 : rest.indexOf(")", prefix.length);
    if (end < 0) return false;
    rest = rest.slice(end + 1);
  }
  return echoed.length > 0 && rest.length === 0;
}

export async function readSteeringCandidate(
  user: UserUpdate,
  read: () => Promise<ReadableStreamReadResult<SessionUpdate>>,
  isRoot: (value: SessionUpdate) => boolean,
) {
  const id = user.messageId ?? "user";
  let text = "";
  let encodedLength = 0;
  let next: ReadableStreamReadResult<SessionUpdate>;
  const media: { offset: number; labelLength: number; fragment: UserUpdate }[] = [];
  let fragment: UserUpdate | undefined = user;
  do {
    const label = contentText(fragment.content);
    const encoded = mediaInput(fragment.content)?.encoded;
    if (
      encoded &&
      media.length < MAX_AGENT_IMAGES &&
      encodedLength + encoded.length <= Math.ceil((MAX_AGENT_FILE_TOTAL_BYTES * 4) / 3) + 4
    ) {
      encodedLength += encoded.length;
      media.push({ offset: text.length, labelLength: label.length, fragment });
    }
    text += label;
    next = await read();
    if (text.length > MAX_AGENT_TEXT_BYTES * 2 || next.done || !isRoot(next.value)) break;
    fragment = userUpdate(next.value);
  } while (fragment?.messageId === id);

  return {
    text,
    next,
    *updates(): Generator<UserUpdate> {
      // 与本地引导正文不匹配时，按原位置重放新消息的富内容。
      let offset = 0;
      const appendText = (value: string): UserUpdate => ({
        sessionUpdate: "user_message_chunk",
        messageId: id,
        content: { type: "text", text: value },
      });
      for (const block of media) {
        if (offset < block.offset) yield appendText(text.slice(offset, block.offset));
        yield block.fragment;
        offset = block.offset + block.labelLength;
      }
      if (!media.length || offset < text.length) yield appendText(text.slice(offset));
    },
  };
}
