import { readFile, stat } from "node:fs/promises";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentItem, AgentMessageAttachment } from "@codexly/protocol";
import type { AgentProviderTurnInput } from "@codexly/core";

/** 图片先校验大小再读取；展示预算不能裁剪交给官方 SDK 的实际输入。 */
export async function createClaudePrompt(
  input: AgentProviderTurnInput,
  sessionId: string,
  turnId: NonNullable<SDKUserMessage["uuid"]>,
): Promise<SDKUserMessage> {
  const content: Exclude<SDKUserMessage["message"]["content"], string> = [
    { type: "text", text: input.text || " " },
  ];
  for (const attachment of input.textAttachments)
    content.push({ type: "text", text: `${attachment.name}\n${attachment.text}` });
  for (const file of input.files)
    content.push({ type: "text", text: `Attached file: ${file.path}` });
  let imageBytes = 0;
  for (const image of input.images) {
    const size = (await stat(image.path)).size;
    imageBytes += size;
    if (size > 5 * 1024 * 1024 || imageBytes > 20 * 1024 * 1024)
      throw new Error("Claude images are limited to 5 MiB each and 20 MiB per turn");
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: (await readFile(image.path)).toString("base64"),
      },
    });
  }
  const prompt: SDKUserMessage = {
    type: "user",
    uuid: turnId,
    session_id: sessionId,
    parent_tool_use_id: null,
    message: { role: "user", content },
  };
  return prompt;
}

export type ClaudeUserInput = string | { text: string; attachments: AgentMessageAttachment[] };

/** 用户消息只投影稳定引用；正文留在共享仓储，事件不能携带图片 Base64 或文本附件内容。 */
export function createClaudeUserItem(id: string, input: ClaudeUserInput): AgentItem {
  const { text, attachments } =
    typeof input === "string" ? { text: input, attachments: [] } : input;
  return {
    id,
    type: "message",
    role: "user",
    text,
    ...(attachments.length ? { attachments } : {}),
  };
}
