import {
  boundTaskTitleInput,
  type AgentProviderTurnInput,
  type LocalCatalogStore,
  type LocalTask,
} from "@codexly/core";
import type { AcpHistory } from "./history.js";

function previewText(text: string, ...sources: (readonly { name: string }[])[]): string {
  const line = boundTaskTitleInput(text).split(/\r?\n/u, 1)[0]?.trim();
  if (line) return line;
  for (const items of sources) {
    const name = items.find((item) => item.name.trim())?.name;
    if (name) return boundTaskTitleInput(name).split(/\r?\n/u, 1)[0]?.trim() ?? "";
  }
  return "";
}

async function firstTurn(history: AcpHistory, id: string) {
  // 只读取第一条已提交回合。提前结束迭代会关闭文件流，不扫描后续历史。
  for await (const entry of history.entries(id)) return entry.turn;
}

export async function persistAcpTaskPreview(
  store: LocalCatalogStore,
  history: AcpHistory,
  task: LocalTask,
  input?: AgentProviderTurnInput,
): Promise<LocalTask | undefined> {
  if (task.title || task.preview) return;
  // 旧会话续聊优先从已提交的首条消息恢复，避免把本次输入当作已有会话的标题。
  const first = task.sessionId ? await firstTurn(history, task.id) : undefined;
  const message = first?.items.find((item) => item.type === "message" && item.role === "user");
  let preview = "";
  if (message?.type === "message") {
    preview = previewText(message.text, message.skills ?? [], message.attachments ?? []);
  } else if (!first && input) {
    preview =
      previewText(input.text, input.skills, input.files, input.textAttachments) ||
      (input.images.length ? "图片任务" : "");
  }
  // 目录仅插入首份预览，并返回当时最新的任务行，正式标题始终优先。
  if (preview) return store.catalog("task.preview", { id: task.id, preview });
}
