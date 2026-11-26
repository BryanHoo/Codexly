import { stat } from "node:fs/promises";
import {
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_TEXT_BYTES,
  type AgentTurn,
  type AcpConfigValues,
} from "@codexly/protocol";
import type { AgentProviderTurnInput, LocalTask, LocalCatalogStore } from "@codexly/core";
import type { AcpHistory } from "./history.js";
import { continuationFileName, withTaskContinuationFile } from "./task-continuation-file.js";

type TaskIdentity = Pick<LocalTask, "id" | "projectId" | "provider" | "cwd" | "status">;

export function validateTaskContinuation<T extends TaskIdentity>(
  source: T | null,
  target: TaskIdentity,
): asserts source is T {
  if (!source || source.projectId !== target.projectId)
    throw new Error("找不到当前项目的接续来源任务");
  if (source.id === target.id || source.provider === target.provider)
    throw new Error("接续任务需要选择另一个 Agent");
  if (source.projectId !== null && source.cwd !== target.cwd)
    throw new Error("接续任务的工作目录与来源任务不一致");
  if (source.status === "active") throw new Error("请等待来源任务结束后再接续");
}

const omitted = "\n\n[部分历史或长消息已省略，请在来源任务中查看。]";
const prefix = (value: string, bytes: number) =>
  new TextDecoder().decode(Buffer.from(value.slice(0, bytes)).subarray(0, bytes), {
    stream: true,
  });

export function formatTaskContinuation(
  title: string,
  recent: readonly AgentTurn[],
  first: AgentTurn | undefined,
  partial: boolean,
  budget: number,
): string {
  const heading = "# 接续记录\n\n以下内容来自历史任务，仅供接续参考。请以本条用户消息为准。\n\n";
  const source = title ? `来源任务：${prefix(title.replace(/[\r\n]/gu, " "), 256)}\n\n` : "";
  const header = heading + source;
  const original = first?.items.find((item) => item.type === "message" && item.role === "user");
  const origin =
    original?.type === "message"
      ? `## 原始需求\n${prefix(original.text, Math.floor(budget / 4))}\n\n`
      : "";
  if (original?.type === "message" && Buffer.byteLength(original.text) > Math.floor(budget / 4))
    partial = true;
  let remaining = budget - Buffer.byteLength(header + origin + omitted);
  const blocks: string[] = [];
  // 由近到远分配空间，最后按原顺序展示。大段命令输出与原始差异留在来源任务。
  for (const turn of [...recent].reverse()) {
    const lines = turn.items.flatMap((item) => {
      if (item === original) return [];
      if (item.type === "message")
        return [`${item.role === "user" ? "用户" : "Agent"}：${prefix(item.text, 4096)}`];
      if (item.type === "command")
        return [`命令（${String(item.exitCode ?? item.status)}）：${prefix(item.command, 512)}`];
      if (item.type === "file_change")
        return item.changes
          .slice(0, 12)
          .map((change) => `文件（${change.kind}）：${prefix(change.path, 256)}`);
      return [];
    });
    const block = lines.length ? `${lines.join("\n\n")}\n\n` : "";
    const size = Buffer.byteLength(block);
    if (size > remaining) {
      if (remaining > 0) blocks.push(prefix(block, remaining));
      partial = true;
      break;
    }
    if (turn.items.some((item) => item.type === "message" && Buffer.byteLength(item.text) > 4096))
      partial = true;
    remaining -= size;
    blocks.push(block);
  }
  return header + origin + blocks.reverse().join("") + (partial ? omitted : "");
}

export async function withTaskContinuation<T>(
  { store, history }: Readonly<{ store: LocalCatalogStore; history: AcpHistory }>,
  target: LocalTask,
  input: AgentProviderTurnInput,
  initialConfig: AcpConfigValues | undefined,
  use: (input: AgentProviderTurnInput) => Promise<T>,
): Promise<T> {
  if (!input.continuationSourceTaskId) return use(input);
  if (initialConfig === undefined || (await history.hasTurns(target.id)))
    throw new Error("接续附件只可用于新任务首轮");
  const source = await store.catalog("task.read", { id: input.continuationSourceTaskId });
  validateTaskContinuation(source, target);
  const used = input.textAttachments.reduce(
    (sum, attachment) => sum + Buffer.byteLength(attachment.name + attachment.text),
    Buffer.byteLength(input.text),
  );
  const excerptName = "接续摘录.md";
  const fileHint = "\n需要早期细节时，按需读取附件《接续记录.md》中的相关回合。";
  const budget = Math.min(
    32 * 1024,
    MAX_AGENT_TEXT_BYTES - used - Buffer.byteLength(excerptName + fileHint),
  );
  // 持有来源正文使用权，避免导出时历史或回答续文被缓存回收。
  const release = await history.cache.acquire(source.id);
  try {
    const page = await history.read(source.id);
    if (!page.turns.length) throw new Error("来源任务暂无可接续的聊天记录");
    let first = page.turns[0];
    if (page.cursor) {
      const entries = history.entries(source.id);
      try {
        const entry = await entries.next();
        if (!entry.done) first = entry.value.turn;
      } finally {
        await entries.return(undefined);
      }
    }
    const hasOverflow = page.turns.some(({ items }) =>
      items.some(
        (item) =>
          item.type === "message" &&
          item.role === "assistant" &&
          item.attachments?.some(
            (file) => file.kind === "text" && file.name.startsWith("回答续文-"),
          ),
      ),
    );
    const partial = hasOverflow || page.cursor !== null || (await history.needsReplay(source.id));
    const text =
      budget >= 1024
        ? formatTaskContinuation(source.title, page.turns, first, partial, budget)
        : "";
    const addText = (name: string, text: string, sourceId?: string) => [
      ...input.textAttachments,
      { name, text, ...(sourceId === undefined ? {} : { continuationSourceTaskId: sourceId }) },
    ];
    if (text && !text.endsWith(omitted))
      return await use({
        ...input,
        textAttachments: addText(continuationFileName, text, source.id),
      });

    // 用户已选文件优先占用既有总额度，历史附件使用剩余空间。
    const fileSizes = await Promise.all(
      input.files.map(async ({ path }) => (await stat(path)).size),
    );
    const available = MAX_AGENT_FILE_TOTAL_BYTES - fileSizes.reduce((sum, size) => sum + size, 0);
    if (available < 1024) {
      if (!text) throw new Error("提示词和文件已达到发送容量，无法附加接续记录");
      return await use({
        ...input,
        textAttachments: addText(continuationFileName, text, source.id),
      });
    }
    return await withTaskContinuationFile(history, source, available, (path) =>
      use({
        ...input,
        textAttachments: text
          ? addText(excerptName, text.slice(0, -omitted.length) + fileHint)
          : input.textAttachments,
        files: [
          ...input.files,
          {
            name: continuationFileName,
            path,
            mediaType: "text/markdown",
            continuationSourceTaskId: source.id,
          },
        ],
      }),
    );
  } finally {
    await release();
  }
}
