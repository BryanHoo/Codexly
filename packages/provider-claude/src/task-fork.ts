import { randomUUID } from "node:crypto";
import type { LocalCatalogStore, LocalTask } from "@codexly/core";
import type { ClaudeConfiguration } from "./config.js";
import { record } from "./sdk-values.js";
import { canResume, type ClaudeSdk } from "./session.js";

/** 展示块沿用 Anthropic 响应 message.id；原生 fork 只重建 transcript UUID，不改变响应 ID。 */
async function nativeForkPoint(
  task: LocalTask,
  turnId: string,
  config: ClaudeConfiguration,
  sdk: ClaudeSdk,
): Promise<string> {
  const sessionId = task.sessionId;
  if (!sessionId) throw new Error("Claude 原生会话不存在");
  let cursor: string | null | undefined;
  for (;;) {
    const page = await config.history.read(task.id, cursor ?? undefined);
    const turn = page.turns.find((entry) => entry.id === turnId);
    if (turn) {
      if (turn.status === "running") throw new Error("Claude 执行中的回合不能分叉");
      // 优先读取磁盘索引里的最新正文块，不能依赖有界展示快照恰好保留目标消息。
      let before: number | null = null;
      let messageId: string | undefined;
      do {
        const items = await config.history.items.read(task.id, turnId, before);
        const assistant = (items?.items ?? turn.items).findLast(
          (item) => item.type === "message" && item.role === "assistant",
        );
        messageId = assistant ? /^(.+):\d+$/u.exec(assistant.id)?.[1] : undefined;
        before = items?.before ?? null;
      } while (!messageId && before !== null);
      if (!messageId) throw new Error("此 Claude 回合没有可分叉的原生回复消息");
      // 每次按当前会话重新解析 UUID，分支的历史回合不能复用源会话已被重建的 UUID。
      let found: string | undefined;
      for (let offset = 0; ; offset += 100) {
        const messages = await sdk.getSessionMessages(sessionId, {
          dir: task.cwd,
          offset,
          limit: 100,
        });
        const native = messages.findLast(
          (entry) =>
            entry.type === "assistant" &&
            !entry.parent_tool_use_id &&
            record(entry.message)["id"] === messageId,
        );
        // 同一响应可能拆成多条 transcript 消息，包含最后一块才是完整的回复边界。
        if (native) found = native.uuid;
        if (messages.length < 100) break;
      }
      if (found) return found;
      throw new Error("Claude 原生历史中已找不到此分叉位置，请选择仍可恢复的回复");
    }
    cursor = page.cursor;
    if (cursor === null) throw new Error("Claude 分叉回合不存在");
  }
}

/** 调用者已占用源任务并关闭空闲 Query；全部历史保存成功后才公开独立的应用任务。 */
export async function forkClaudeTask(
  task: LocalTask,
  lastTurnId: string | undefined,
  config: ClaudeConfiguration,
  sdk: ClaudeSdk,
  store: LocalCatalogStore,
) {
  const recovery = await config.persistence.retry(task.id);
  if (recovery?.pending) throw new Error("Claude 历史持久化尚未完成，请恢复存储后分叉");
  const metadata = await config.history.metadata(task.id);
  const sessionId = task.sessionId;
  if (!sessionId || !sdk.forkSession || !(await canResume(task, sdk, config.history, metadata)))
    throw new Error("Claude 会话尚未建立，无法分叉");
  await config.history.archiveActive(task.id);
  const upToMessageId =
    lastTurnId === undefined ? undefined : await nativeForkPoint(task, lastTurnId, config, sdk);
  const result = await sdk.forkSession(sessionId, {
    dir: task.cwd,
    ...(upToMessageId ? { upToMessageId } : {}),
  });
  if (!result.sessionId || result.sessionId === task.sessionId)
    throw new Error("Claude 分叉未返回独立会话 ID");
  const target = `task-${randomUUID()}`;
  try {
    await config.history.forkTask(task.id, target, lastTurnId, async (turn) => {
      let before: number | null = null;
      do {
        const page = await config.history.items.read(task.id, turn.id, before);
        for (const item of page?.items ?? turn.items)
          if (item.type === "message")
            for (const attachment of item.attachments ?? [])
              await config.attachments.forkAttachment(task.id, target, attachment.id);
        before = page?.before ?? null;
      } while (before !== null);
    });
    // 历史截断后不能继承未来回合的计划、统计或运行中的 MCP 状态。
    await config.history.saveMetadata(target, {
      sessionInitialized: true,
      contextUsage: null,
      plan: null,
      model: null,
      mcpServers: [],
    });
    return await store.catalog("task.put", {
      ...task,
      id: target,
      sessionId: result.sessionId,
      title: `${task.title || "新聊天"}（分叉）`,
      pinned: false,
      archived: false,
      status: "idle",
      updatedAt: Date.now() / 1000,
    });
  } catch (error) {
    const cleanup = await Promise.allSettled([
      sdk.deleteSession(result.sessionId, { dir: task.cwd }),
      config.persistence.deleteTask(target),
      config.attachments.deleteTask(target),
    ]);
    const failures = cleanup.filter((entry) => entry.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        [error, ...failures.map((entry) => entry.reason as unknown)],
        "Claude 分叉保存失败，部分清理失败",
        { cause: error },
      );
    throw error;
  }
}
