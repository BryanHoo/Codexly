import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContentBlock, PromptCapabilities } from "@agentclientprotocol/sdk/unstable";
import type { AgentProviderTurnInput } from "@codexly/core";
import {
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  MAX_AGENT_TEXT_BYTES,
} from "@codexly/protocol";

/** 只构造标准 ACP 内容块；文件引用先持久化，不能依赖 Server 在提交后清理的临时上传。 */
export async function createAcpPrompt(
  input: AgentProviderTurnInput,
  capabilities: PromptCapabilities,
  directory: string,
): Promise<ContentBlock[]> {
  if (input.skills.length || input.outputSchema)
    throw new Error("当前 ACP 输入不支持旧技能或结构化输出设置");
  if (input.images.length && !capabilities.image) throw new Error("ACP agent 不支持图片输入");
  if (input.images.length > MAX_AGENT_IMAGES) throw new Error("图片数量超过预算");
  const textBytes =
    Buffer.byteLength(input.text) +
    input.textAttachments.reduce(
      (sum, a) => sum + Buffer.byteLength(a.text) + Buffer.byteLength(a.name),
      0,
    );
  if (textBytes > MAX_AGENT_TEXT_BYTES) throw new Error("文本输入超过预算");
  const prompt: ContentBlock[] = input.text ? [{ type: "text", text: input.text }] : [];
  for (const attachment of input.textAttachments)
    prompt.push({ type: "text", text: `${attachment.name}\n${attachment.text}` });
  let imageBytes = 0;
  for (const image of input.images) {
    const file = await open(image.path, "r");
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_AGENT_IMAGE_BYTES)
        throw new Error("图片超过预算或不是普通文件");
      imageBytes += info.size;
      if (imageBytes > MAX_AGENT_IMAGE_TOTAL_BYTES) throw new Error("图片总大小超过预算");
      // 固定长度读取，防止源文件在 stat 后增长而引发无界分配。
      const data = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < data.length) {
        const result = await file.read(data, offset, data.length - offset, offset);
        if (!result.bytesRead) throw new Error("图片在读取期间发生变化");
        offset += result.bytesRead;
      }
      prompt.push({ type: "image", mimeType: image.mediaType, data: data.toString("base64") });
    } finally {
      await file.close();
    }
  }
  const saved: string[] = [];
  let fileBytes = 0;
  try {
    for (const file of input.files) {
      const source = await stat(file.path);
      if (!source.isFile() || source.size > MAX_AGENT_FILE_BYTES)
        throw new Error("文件超过预算或不是普通文件");
      fileBytes += source.size;
      if (fileBytes > MAX_AGENT_FILE_TOTAL_BYTES) throw new Error("文件总大小超过预算");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, randomUUID());
      await copyFile(file.path, path, constants.COPYFILE_EXCL);
      saved.push(path);
      if ((await stat(path)).size !== source.size) throw new Error("文件在保存期间发生变化");
      prompt.push({
        type: "resource_link",
        name: file.name,
        mimeType: file.mediaType,
        uri: pathToFileURL(path).href,
      });
    }
    if (!prompt.length) throw new Error("ACP 输入不能为空");
    // 官方 agent 的标准 NDJSON 入站限制为32MiB，超出时在发送前明确拒绝，避免提交结果不确定。
    if (Buffer.byteLength(JSON.stringify(prompt)) > 32 * 1024 * 1024 - 64 * 1024)
      throw new Error("ACP 输入超过传输预算");
    return prompt;
  } catch (error) {
    await Promise.all(saved.map((path) => rm(path, { force: true })));
    throw error;
  }
}
