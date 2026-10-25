import type { AgentTask, AgentTaskSnapshot, AgentTurn } from "@codexly/protocol";

export const MAX_CONVERSATION_EXPORT_BYTES = 64 * 1_048_576;
// 导出只依赖条目身份，不解释各端的消息/工具变体，保留原始结构而不强制转换桌面私有字段。
type ExportTurn = Omit<AgentTurn, "items"> & { items: { id: string }[] };
type ExportSnapshot = Pick<
  AgentTaskSnapshot,
  "id" | "projectId" | "title" | "engine" | "status" | "updatedAt" | "turnsNextCursor"
> & { turns: ExportTurn[] };
interface Client {
  readTask(
    projectId: string,
    taskId: string,
    options: { cursor?: string; summary: boolean },
  ): Promise<{ snapshot: ExportSnapshot }>;
}
interface CollectedTurn {
  metadata: Omit<AgentTurn, "items" | "processCursor">;
  chunks: { id: string }[][];
  seenItems: Set<string>;
}

export interface ConversationRecord {
  format: "codexly-conversation";
  version: 1;
  exportedAt: string;
  task: Pick<ExportSnapshot, "id" | "projectId" | "title" | "status" | "updatedAt"> & {
    engine: "codex" | "claude";
  };
  turns: Omit<ExportTurn, "processCursor">[];
}

/** 两端只在显式导出时遍历完整历史，不读取视图缓存或把导出结果放入任务 Store。 */
export async function createConversationExport(
  client: Client,
  task: AgentTask,
  exportedAt = new Date(),
) {
  const turns = new Map<string, CollectedTurn>();
  const turnChunks: CollectedTurn[][] = [];
  const seenCursors = new Set<string>();
  const encoder = new TextEncoder();
  let bytes = 0;
  let cursor: string | undefined;
  let metadata: ConversationRecord["task"] | undefined;
  do {
    const { snapshot } = await client.readTask(task.projectId, task.id, {
      summary: false,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (snapshot.id !== task.id || snapshot.projectId !== task.projectId)
      throw new Error("Conversation export identity mismatch");
    metadata ??= {
      id: snapshot.id,
      projectId: snapshot.projectId,
      title: snapshot.title,
      engine: snapshot.engine ?? task.engine ?? "codex",
      status: snapshot.status,
      updatedAt: snapshot.updatedAt,
    };
    // 输入页和最终 JSON 都限制 UTF-8 字节；异常时直接失败，绝不静默截断后报告成功。
    bytes += encoder.encode(JSON.stringify(snapshot.turns)).byteLength;
    if (bytes > MAX_CONVERSATION_EXPORT_BYTES)
      throw new RangeError("Conversation export exceeds 64 MiB");
    const added: CollectedTurn[] = [];
    for (const turn of snapshot.turns) {
      let collected = turns.get(turn.id);
      if (collected === undefined) {
        const { items: _items, processCursor: _processCursor, ...turnMetadata } = turn;
        collected = { metadata: turnMetadata, chunks: [], seenItems: new Set() };
        turns.set(turn.id, collected);
        added.push(collected);
      } else if (turn.itemTimings !== undefined) {
        const timings = { ...collected.metadata.itemTimings };
        for (const [id, timing] of Object.entries(turn.itemTimings))
          timings[id] = { ...timing, ...timings[id] };
        collected.metadata = { ...collected.metadata, itemTimings: timings };
      }
      const items = turn.items.filter((item) => {
        if (collected.seenItems.has(item.id)) return false;
        collected.seenItems.add(item.id);
        return true;
      });
      collected.chunks.push(items);
    }
    turnChunks.push(added);
    const next = snapshot.turnsNextCursor;
    if (next !== null) {
      if (seenCursors.has(next) || seenCursors.size >= 10_000)
        throw new Error("Conversation export cursor did not terminate");
      seenCursors.add(next);
    }
    cursor = next ?? undefined;
  } while (cursor !== undefined);
  // 服务端各页内部为时间正序，续页朝更早历史推进；按块反转避免反复前插复制全部历史。
  const ordered = turnChunks.reverse().flatMap((ids) =>
    ids.map((turn) => {
      return { ...turn.metadata, items: turn.chunks.reverse().flat() };
    }),
  );
  const content =
    JSON.stringify(
      {
        format: "codexly-conversation",
        version: 1,
        exportedAt: exportedAt.toISOString(),
        task: metadata,
        turns: ordered,
      },
      null,
      2,
    ) + "\n";
  if (encoder.encode(content).byteLength > MAX_CONVERSATION_EXPORT_BYTES)
    throw new RangeError("Conversation export exceeds 64 MiB");
  // 只使用固定前缀和时间戳，兼容 Windows 文件名规则，也不暴露标题中的路径或私密信息。
  return {
    fileName: `codexly-conversation-${exportedAt.toISOString().replaceAll(/[:.]/gu, "-")}.json`,
    content,
  };
}
