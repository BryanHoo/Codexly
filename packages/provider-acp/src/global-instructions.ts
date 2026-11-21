import type { ContentBlock } from "@agentclientprotocol/sdk/experimental/v2/unstable";
import { MAX_ACP_GLOBAL_INSTRUCTIONS_LENGTH } from "@codexly/protocol/application-preferences";

const tag = "<codexly-global-instructions ";
const end = "\n</codexly-global-instructions>\n\n";
const header = new RegExp("^" + tag + 'length="([1-9][0-9]{0,4})">\n', "u");

export function addAcpGlobalInstructions(
  prompt: ContentBlock[],
  instructions: string | undefined,
): ContentBlock[] {
  if (!instructions?.trim()) return prompt;
  // ACP v2 的必选文本块不依赖厂商扩展。长度字段用于重放时识别并移除客户端附加段。
  return [
    {
      type: "text",
      text: `${tag}length="${String(instructions.length)}">\n${instructions}${end}`,
    },
    ...prompt,
  ];
}

/** 重放可能拆分客户端附加段，返回 null 表示还需等待剩余文本。 */
export function stripAcpGlobalInstructions(text: string): string | null {
  if (!text.startsWith(tag)) return tag.startsWith(text) ? null : text;
  const match = header.exec(text);
  if (!match) {
    if (text.includes("\n") || text.length > tag.length + 16) return text;
    return null;
  }
  const length = Number(match[1]);
  if (length > MAX_ACP_GLOBAL_INSTRUCTIONS_LENGTH) return text;
  const offset = match[0].length + length;
  if (text.length < offset + end.length) return null;
  return text.startsWith(end, offset) ? text.slice(offset + end.length) : text;
}
