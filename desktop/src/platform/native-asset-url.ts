import { convertFileSrc } from "@tauri-apps/api/core";

export function buildNativeAssetUrl(path: string): string {
  return /^(?:blob:|data:|https?:)/u.test(path) ? path : convertFileSrc(path);
}

/** 历史引用按项目和任务校验后读取；本地 Codex 路径仍走原生 asset 协议。 */
export function buildNativeTaskAttachmentUrl(projectId: string, taskId: string, attachmentId: string): string {
  if (!attachmentId.startsWith("history-")) return buildNativeAssetUrl(attachmentId);
  return `${convertFileSrc("read", "task-attachment")}?${new URLSearchParams({ projectId, taskId, attachmentId })}`;
}
