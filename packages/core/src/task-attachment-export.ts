import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { renameStorageFile } from "./task-storage-files.js";
import { extname, join } from "node:path";
import type { AgentProviderAttachment } from "./agent-provider.js";
import type { AgentMessageAttachment } from "@codexly/protocol";

/** 桌面只按需导出已校验正文；stdio 传路径与媒体类型，不传大块 Base64。 */
export async function exportTaskAttachment(
  store: {
    directory: string;
    read(taskId: string, id: string): Promise<AgentProviderAttachment | undefined>;
    metadata(taskId: string, id: string): Promise<AgentMessageAttachment>;
  },
  taskId: string,
  attachmentId: string,
) {
  const attachment = await store.read(taskId, attachmentId);
  if (!attachment) throw new Error("Task attachment not found");
  const directory = join(
    store.directory,
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
    await renameStorageFile(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return {
    path,
    mediaType: attachment.mediaType,
    attachment: await store.metadata(taskId, attachmentId),
  };
}
