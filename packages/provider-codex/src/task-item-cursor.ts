import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";

const PREFIX = "codexly-items-v1:";
const MAX_CURSOR_BYTES = 8_192;

export type PendingTurnItems = Readonly<{
  cursor: string;
  turn: Record<string, unknown>;
}>;
type ItemContinuation = Readonly<{
  nextTurnCursor: string | null;
  pending: PendingTurnItems[];
  threadId: string;
}>;

export function decodeItemContinuation(
  cursor: string | undefined,
  threadId: string,
): ItemContinuation | undefined {
  if (cursor === undefined || !cursor.startsWith(PREFIX)) return undefined;
  try {
    if (Buffer.byteLength(cursor, "utf8") > MAX_CURSOR_BYTES) throw new Error("oversized");
    const value = expectRecord(JSON.parse(cursor.slice(PREFIX.length)), "Item continuation");
    if (
      value["threadId"] !== threadId ||
      !Array.isArray(value["pending"]) ||
      value["pending"].length === 0 ||
      value["pending"].length > 10
    )
      throw new Error("invalid scope");
    const nextTurnCursor =
      value["nextTurnCursor"] === null
        ? null
        : expectString(value["nextTurnCursor"], "Item continuation turn cursor");
    if (nextTurnCursor === "" || nextTurnCursor?.startsWith(PREFIX))
      throw new Error("invalid cursor");
    const ids = new Set<string>();
    const pending = value["pending"].map((entry) => {
      const record = expectRecord(entry, "Pending turn items");
      const turn = expectRecord(record["turn"], "Pending turn");
      const id = expectString(turn["id"], "Pending turn id");
      const itemCursor = expectString(record["cursor"], "Pending item cursor");
      if (id === "" || itemCursor === "" || ids.has(id)) throw new Error("invalid pending turn");
      ids.add(id);
      // 游标仅携带固定大小的回合元数据，禁止回传 Item 正文或错误正文。
      return { cursor: itemCursor, turn: continuationTurn(turn) };
    });
    return { nextTurnCursor, pending, threadId };
  } catch {
    throw new CodexProtocolMappingError("Task item continuation is invalid");
  }
}

function continuationTurn(turn: Record<string, unknown>): Record<string, unknown> {
  return {
    id: turn["id"],
    status: turn["status"],
    startedAt: turn["startedAt"],
    completedAt: turn["completedAt"],
    error: null,
  };
}

export function encodeItemContinuation(
  threadId: string,
  nextTurnCursor: string | null,
  pending: readonly PendingTurnItems[],
): string | null {
  if (pending.length === 0) return nextTurnCursor;
  const cursor =
    PREFIX +
    JSON.stringify({
      threadId,
      nextTurnCursor,
      pending: pending.map((entry) => ({
        cursor: entry.cursor,
        turn: continuationTurn(entry.turn),
      })),
    });
  if (Buffer.byteLength(cursor, "utf8") > MAX_CURSOR_BYTES)
    throw new CodexProtocolMappingError("Task item continuation is too large");
  return cursor;
}
