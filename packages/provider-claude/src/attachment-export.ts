import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ClaudeAgentProvider } from "./provider.js";

/** 桌面只按需导出已校验正文；stdio 传路径与媒体类型，不传大块 Base64。 */
export async function exportClaudeAttachment(
  provider: ClaudeAgentProvider,
  taskId: string,
  attachmentId: string,
) {
  const attachment = await provider.readTaskAttachment(taskId, attachmentId);
  if (!attachment) throw new Error("Claude attachment not found");
  const directory = join(
    provider.config.attachments.directory,
    "exports",
    createHash("sha256").update(taskId).digest("hex"),
  );
  // 仅保留安全扩展名供系统应用识别，原始文件名不能控制导出路径。
  const extension = extname(attachment.name);
  const suffix = /^\.[a-zA-Z0-9]{1,16}$/u.test(extension) ? extension : "";
  const path = join(
    directory,
    `${createHash("sha256").update(attachmentId).digest("hex")}${suffix}`,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, attachment.content, { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return { path, mediaType: attachment.mediaType };
}
