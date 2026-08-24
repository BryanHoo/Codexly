import {
  stripLeadingAgentSkillReferences,
  type AgentItem,
  type AgentMessageAttachment,
} from "@codexly/protocol";

import { extractCodexTextSkills } from "./codex-transcript.js";

import { CodexProtocolMappingError, expectString, isRecord } from "./codex-mapping-common.js";

export type MapCodexMessageImage = (
  part: Record<string, unknown>,
  imageIndex: number,
) => AgentMessageAttachment | undefined;

export type MapCodexMessageText = (
  input: Readonly<{ name: string; text: string }>,
  textIndex: number,
) => AgentMessageAttachment | undefined;

const codexTextEncoder = new TextEncoder();
const codexTextDecoder = new TextDecoder("utf-8", { fatal: true });

export function mapCodexTextPart(
  part: Record<string, unknown>,
  textIndex: number,
  mapText: MapCodexMessageText,
): Readonly<{ attachments: AgentMessageAttachment[]; text: string }> {
  const text = expectString(part["text"], "Codex user message text");
  const nativeElements = part["text_elements"];
  if (!Array.isArray(nativeElements) || nativeElements.length === 0) {
    return { attachments: [], text };
  }

  const encodedText = codexTextEncoder.encode(text);
  const ranges: { end: number; name: string; start: number }[] = [];
  for (const value of nativeElements) {
    if (!isRecord(value) || !isRecord(value["byteRange"])) {
      return { attachments: [], text };
    }
    const range = value["byteRange"];
    const start = range["start"];
    const end = range["end"];
    const placeholder = value["placeholder"];
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      typeof start !== "number" ||
      typeof end !== "number" ||
      start < 0 ||
      end <= start ||
      end > encodedText.byteLength ||
      typeof placeholder !== "string" ||
      placeholder.trim().length === 0
    ) {
      return { attachments: [], text };
    }
    ranges.push({ end, name: placeholder.trim().slice(0, 255), start });
  }
  ranges.sort((left, right) => left.start - right.start);

  const attachments: AgentMessageAttachment[] = [];
  const visibleText: string[] = [];
  let cursor = 0;
  try {
    for (const range of ranges) {
      if (range.start < cursor) {
        return { attachments: [], text };
      }
      const prefix = codexTextDecoder.decode(encodedText.subarray(cursor, range.start));
      if (prefix.length > 0) {
        visibleText.push(prefix);
      }
      const attachmentText = codexTextDecoder.decode(encodedText.subarray(range.start, range.end));
      const attachment = mapText(
        { name: range.name, text: attachmentText },
        textIndex + attachments.length,
      );
      if (attachment === undefined) {
        visibleText.push(`@${range.name}`);
      } else {
        attachments.push(attachment);
      }
      cursor = range.end;
    }
    const suffix = codexTextDecoder.decode(encodedText.subarray(cursor));
    if (suffix.length > 0) {
      visibleText.push(suffix);
    }
  } catch {
    // 非法 UTF-8 字节边界不能吞掉用户内容，退回原始文本显示。
    return { attachments: [], text };
  }
  return { attachments, text: visibleText.join("") };
}

export function mapUserMessageContent(
  value: unknown,
  mapImage: MapCodexMessageImage,
  mapText: MapCodexMessageText,
): Readonly<{
  attachments: AgentMessageAttachment[];
  skills: { name: string }[];
  text: string;
}> {
  if (!Array.isArray(value)) {
    throw new CodexProtocolMappingError("Codex user message content must be an array");
  }
  const attachments: AgentMessageAttachment[] = [];
  const skills: { name: string }[] = [];
  const textParts: string[] = [];
  let imageIndex = 0;
  let textIndex = 0;

  for (const part of value) {
    if (!isRecord(part)) {
      continue;
    }
    if (part["type"] === "text" && typeof part["text"] === "string") {
      const mappedText = mapCodexTextPart(part, textIndex, mapText);
      attachments.push(...mappedText.attachments);
      textIndex += mappedText.attachments.length;
      const textContent = extractCodexTextSkills(mappedText.text);
      skills.push(...textContent.skills);
      if (textContent.text.length > 0) {
        textParts.push(textContent.text);
      }
      continue;
    }
    if (part["type"] === "skill") {
      // Codex 历史保留 Skill 的 name/path；公开消息只暴露展示所需的 name。
      const name = expectString(part["name"], "Codex user message skill name");
      expectString(part["path"], "Codex user message skill path");
      skills.push({ name });
      continue;
    }
    if (part["type"] === "image" || part["type"] === "localImage") {
      const attachment = mapImage(part, imageIndex);
      imageIndex += 1;
      if (attachment === undefined) {
        textParts.push("[图片]");
      } else {
        attachments.push(attachment);
      }
      continue;
    }
    if (part["type"] === "audio" || part["type"] === "localAudio") {
      textParts.push("[音频]");
    }
  }

  return { attachments, skills, text: textParts.join("\n") };
}

export function mergeExpandedSkillMessages(items: readonly AgentItem[]): AgentItem[] {
  const mergedItems: AgentItem[] = [];

  for (const item of items) {
    const isSkillOnlyMessage =
      item.type === "message" &&
      item.role === "user" &&
      item.text.length === 0 &&
      (item.skills?.length ?? 0) > 0;
    const previousItem = mergedItems.at(-1);
    if (isSkillOnlyMessage && previousItem?.type === "message" && previousItem.role === "user") {
      // 持久化历史把 Skill 指令放在原消息之后，恢复时合并为一个用户气泡。
      const skillNames = new Set((previousItem.skills ?? []).map((skill) => skill.name));
      const mergedSkills = [...(previousItem.skills ?? [])];
      for (const skill of item.skills ?? []) {
        if (!skillNames.has(skill.name)) {
          skillNames.add(skill.name);
          mergedSkills.push(skill);
        }
      }
      mergedItems[mergedItems.length - 1] = {
        ...previousItem,
        skills: mergedSkills,
        text: stripLeadingAgentSkillReferences(previousItem.text, mergedSkills),
      };
      continue;
    }
    mergedItems.push(item);
  }

  return mergedItems;
}
