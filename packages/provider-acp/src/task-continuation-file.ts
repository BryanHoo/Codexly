import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { LocalTask } from "@codexly/core";
import type { AcpHistory } from "./history.js";

const truncation = "\n\n[接续附件已达到文件容量上限，后续正文请查看来源任务。]\n";
const missing = "\n\n[来源历史暂有缺口，此文件包含当前可读取的聊天正文。]\n";
export const continuationFileName = "接续记录.md";

async function* historyMarkdown(history: AcpHistory, source: LocalTask) {
  yield "# 接续记录\n\n以下是来源任务的历史对话，请以本轮的用户消息为准。\n";
  let round = 0;
  for await (const { turn } of history.entries(source.id)) {
    yield `\n## 回合 ${String(++round)}\n\n`;
    for (const item of turn.items) {
      if (item.type !== "message") continue;
      yield item.role === "user" ? "### 用户\n\n" : "### Agent\n\n";
      if (item.text) yield item.text;
      // 超出消息快照预览的回答以分块文本附件保存，按记录顺序补回正文。
      for (const attachment of item.attachments ?? []) {
        if (
          item.role !== "assistant" ||
          attachment.kind !== "text" ||
          !/^回答续文-[1-9][0-9]*\.txt$/u.test(attachment.name)
        )
          continue;
        const saved = await history.cache.content(source.id).read(source.id, attachment.id);
        yield saved ? Buffer.from(saved.content).toString("utf8") : missing;
      }
      yield "\n\n";
    }
  }
  if (await history.needsReplay(source.id)) yield missing;
}

/** 边读历史边落盘，只在总文件配额耗尽时截断；通过迭代器背压避免累积长对话。 */
export async function withTaskContinuationFile<T>(
  history: AcpHistory,
  source: LocalTask,
  budget: number,
  use: (path: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(history.directory, "acp-continuation-"));
  const path = join(directory, continuationFileName);
  async function* boundedMarkdown() {
    let remaining = budget - Buffer.byteLength(truncation);
    for await (const part of historyMarkdown(history, source)) {
      remaining -= Buffer.byteLength(part);
      if (remaining < 0) {
        yield truncation;
        return;
      }
      yield part;
    }
  }
  try {
    await pipeline(
      Readable.from(boundedMarkdown()),
      createWriteStream(path, { flags: "wx", mode: 0o600 }),
    );
    return await use(path);
  } finally {
    // 发送副本与历史附件已经各自落盘，暂存不应跨回合保留。
    await rm(directory, { recursive: true, force: true });
  }
}
