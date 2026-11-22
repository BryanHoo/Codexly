import type { LocalTask, ReadAgentTaskInput } from "@codexly/core";
import type { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import { startCodexAppServer, type StartCodexAppServerOptions } from "./app-server-process.js";
import { expectRecord, mapAgentTurns } from "./codex-protocol-mapping.js";
import { readNativeTaskTurnPage, readThreadHistoryMode } from "./task-history-pagination.js";
import { resolveTaskAttachmentMapping } from "./resolve-attachment-mapping.js";
import { mapCodexMessageImage, mapCodexMessageText } from "./agent-provider-message-attachments.js";

const PREFIX = "acp-readonly:";
export function isCodexReadOnlyCursor(cursor?: string): boolean {
  return cursor?.startsWith(PREFIX) === true;
}

/** 只读 RPC 不恢复会话或取得写入权；游标同时绑定应用任务和原生会话。 */
export async function readCodexReadOnlyHistory(
  task: LocalTask,
  input: ReadAgentTaskInput,
  attachments: HistoricalTaskAttachments,
  options: StartCodexAppServerOptions,
) {
  if (!task.sessionId) throw new Error("任务尚未绑定原生会话");
  let cursor: string | undefined;
  if (input.cursor) {
    if (!isCodexReadOnlyCursor(input.cursor) || input.cursor.length > 16384)
      throw new Error("只读历史游标无效");
    const value = expectRecord(
      JSON.parse(Buffer.from(input.cursor.slice(PREFIX.length), "base64url").toString()),
      "只读历史游标",
    );
    if (
      value["task"] !== task.id ||
      value["session"] !== task.sessionId ||
      typeof value["cursor"] !== "string"
    )
      throw new Error("只读历史游标不属于当前任务");
    cursor = value["cursor"];
  }
  const encode = (next: string | null) =>
    next === null
      ? null
      : PREFIX +
        Buffer.from(
          JSON.stringify({
            task: task.id,
            session: task.sessionId,
            cursor: next,
          }),
        ).toString("base64url");
  input.signal?.throwIfAborted();
  const process = await startCodexAppServer({ ...options, cwd: task.cwd, readOnlyHistory: true });
  try {
    // 每次 RPC 传递同一取消信号；离开读取边界后必须回收独占进程。
    const client = {
      notify: process.client.notify.bind(process.client),
      onNotification: process.client.onNotification.bind(process.client),
      onServerRequest: process.client.onServerRequest.bind(process.client),
      rejectServerRequest: process.client.rejectServerRequest.bind(process.client),
      respondToServerRequest: process.client.respondToServerRequest.bind(process.client),
      request: (method: string, params?: unknown) =>
        process.client.request(method, params, undefined, input.signal),
    };
    const response = expectRecord(
      await client.request("thread/read", { threadId: task.sessionId, includeTurns: false }),
      "只读会话",
    );
    const thread = expectRecord(response["thread"], "只读会话元数据");
    if (thread["id"] !== task.sessionId) throw new Error("只读历史返回了其他会话");
    const page = await readNativeTaskTurnPage(
      client,
      task.sessionId,
      readThreadHistoryMode(thread),
      cursor,
      false,
    );
    const turns = await resolveTaskAttachmentMapping(
      task.id,
      (image, text) => mapAgentTurns(page.turns, image, text),
      (id, part, index) => mapCodexMessageImage(attachments.store, id, part, index, input.signal),
      (id, text, index) => mapCodexMessageText(attachments.store, id, text, index, input.signal),
    );
    // 与普通任务共用持久附件仓储，分页读取结束后引用仍然可用。
    await attachments.prepare(task.id, {
      text: "",
      files: [],
      images: [],
      skills: [],
      textAttachments: [],
    });
    input.signal?.throwIfAborted();
    return { turns, cursor: encode(page.nextTurnCursor) };
  } finally {
    await process.close();
  }
}
