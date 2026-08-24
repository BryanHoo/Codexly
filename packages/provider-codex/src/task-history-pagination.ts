import type { ReadAgentTaskInput } from "@codexly/core";

import type { CodexRpcClient } from "./agent-provider-base.js";
import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";

export const TASK_TURN_PAGE_LIMIT = 10;
const TASK_ITEM_PAGE_LIMIT = 100;
const MAX_TASK_TURN_CURSOR_BYTES = 8_192;

export type CodexThreadHistoryMode = "legacy" | "paginated";

export type TaskTurnCursorState = Readonly<{
  itemCursor?: string | null;
  reviewCursor?: string | null;
  turnCursor?: string;
}>;

export type NativeTaskTurnPage = Readonly<{
  nextItemCursor: string | null;
  nextTurnCursor: string | null;
  turns: unknown[];
}>;

type NativeThreadItemEntry = Readonly<{
  item: Record<string, unknown>;
  turnId: string;
}>;

type NativeThreadItemPage = Readonly<{
  backwardsCursor: string | null;
  entries: NativeThreadItemEntry[];
  nextCursor: string | null;
}>;

export function readThreadHistoryMode(thread: Record<string, unknown>): CodexThreadHistoryMode {
  const historyMode = expectString(thread["historyMode"], "Codex thread historyMode");
  if (historyMode !== "legacy" && historyMode !== "paginated") {
    throw new CodexProtocolMappingError("Codex thread historyMode is invalid");
  }
  return historyMode;
}

export function decodeTaskTurnCursor(input: ReadAgentTaskInput = {}): TaskTurnCursorState {
  if (input.cursor === undefined) {
    return {};
  }
  if (Buffer.byteLength(input.cursor, "utf8") > MAX_TASK_TURN_CURSOR_BYTES) {
    throw new CodexProtocolMappingError("Task turn cursor is too large");
  }
  try {
    const value = expectRecord(
      JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
      "Task turn cursor",
    );
    const itemCursor = value["itemCursor"];
    const reviewCursor = value["reviewCursor"];
    const turnCursor = value["turnCursor"];
    if (
      value["version"] !== 3 ||
      !(itemCursor === null || (typeof itemCursor === "string" && itemCursor.length > 0)) ||
      !(
        reviewCursor === undefined ||
        reviewCursor === null ||
        (typeof reviewCursor === "string" && reviewCursor.length > 0)
      ) ||
      typeof turnCursor !== "string" ||
      turnCursor.length === 0
    ) {
      throw new CodexProtocolMappingError("Task turn cursor is invalid");
    }
    return {
      itemCursor,
      ...(reviewCursor === undefined ? {} : { reviewCursor }),
      turnCursor,
    };
  } catch (error) {
    if (error instanceof CodexProtocolMappingError) {
      throw error;
    }
    throw new CodexProtocolMappingError("Task turn cursor is invalid");
  }
}

export function encodeTaskTurnCursor(
  turnCursor: string | null,
  itemCursor: string | null,
  reviewCursor: string | null | undefined,
): string | null {
  if (turnCursor === null) {
    return null;
  }
  return Buffer.from(
    JSON.stringify({ itemCursor, reviewCursor, turnCursor, version: 3 }),
    "utf8",
  ).toString("base64url");
}

async function readThreadItemPage(
  client: CodexRpcClient,
  threadId: string,
  cursor: string | null | undefined,
  limit: number,
): Promise<NativeThreadItemPage> {
  const response = expectRecord(
    await client.request("thread/items/list", {
      ...(typeof cursor === "string" ? { cursor } : {}),
      limit,
      sortDirection: "desc",
      threadId,
    }),
    "thread/items/list response",
  );
  if (!Array.isArray(response["data"])) {
    throw new CodexProtocolMappingError("thread/items/list data must be an array");
  }
  const readCursor = (name: "backwardsCursor" | "nextCursor"): string | null => {
    const value = response[name];
    if (value === null) {
      return null;
    }
    const result = expectString(value, `thread/items/list ${name}`);
    if (result.length === 0) {
      throw new CodexProtocolMappingError(`thread/items/list ${name} must not be empty`);
    }
    return result;
  };
  return {
    backwardsCursor: readCursor("backwardsCursor"),
    entries: response["data"].map((value) => {
      const entry = expectRecord(value, "Codex thread item entry");
      return {
        item: expectRecord(entry["item"], "Codex thread item"),
        turnId: expectString(entry["turnId"], "Codex thread item turn id"),
      };
    }),
    nextCursor: readCursor("nextCursor"),
  };
}

function assertAdvancingItemCursor(
  current: string | null | undefined,
  next: string,
  seenCursors: Set<string>,
): void {
  if (next === current || seenCursors.has(next)) {
    throw new CodexProtocolMappingError("thread/items/list returned a repeated cursor");
  }
  seenCursors.add(next);
}

async function hydratePaginatedTurnItems(
  client: CodexRpcClient,
  threadId: string,
  turns: readonly Record<string, unknown>[],
  itemCursor: string | null | undefined,
  hasOlderTurns: boolean,
): Promise<Readonly<{ nextItemCursor: string | null; turns: unknown[] }>> {
  const itemsByTurnId = new Map<string, Record<string, unknown>[]>();
  const turnIds = new Set(turns.map((turn) => expectString(turn["id"], "Codex turn id")));
  const seenCursors = new Set<string>();
  let cursor = itemCursor;

  while (cursor !== null) {
    const page = await readThreadItemPage(client, threadId, cursor, TASK_ITEM_PAGE_LIMIT);
    const boundaryIndex = page.entries.findIndex((entry) => !turnIds.has(entry.turnId));
    if (
      boundaryIndex >= 0 &&
      page.entries.slice(boundaryIndex + 1).some((entry) => turnIds.has(entry.turnId))
    ) {
      throw new CodexProtocolMappingError("thread/items/list returned non-contiguous turns");
    }
    if (boundaryIndex >= 0 && !hasOlderTurns) {
      throw new CodexProtocolMappingError("thread/items/list returned an unknown turn");
    }

    let entries = page.entries;
    let nextCursor = page.nextCursor;
    if (boundaryIndex === 0) {
      // 当前 Turn 页没有持久 Item，保留首项锚点供下一 Turn 页继续读取。
      const boundaryCursor = typeof cursor === "string" ? cursor : page.backwardsCursor;
      if (boundaryCursor === null) {
        throw new CodexProtocolMappingError("thread/items/list omitted its boundary cursor");
      }
      return { nextItemCursor: boundaryCursor, turns: hydrateTurns(turns, itemsByTurnId) };
    }
    if (boundaryIndex > 0) {
      // 缩限重放把原生 Item Cursor 精确停在下一 Turn 页边界，避免跨页跳项。
      const alignedPage = await readThreadItemPage(client, threadId, cursor, boundaryIndex);
      if (alignedPage.entries.length !== boundaryIndex || alignedPage.nextCursor === null) {
        throw new CodexProtocolMappingError("thread/items/list could not align the turn boundary");
      }
      assertAdvancingItemCursor(cursor, alignedPage.nextCursor, seenCursors);
      entries = alignedPage.entries;
      nextCursor = alignedPage.nextCursor;
    }

    for (const entry of entries) {
      const items = itemsByTurnId.get(entry.turnId) ?? [];
      items.push(entry.item);
      itemsByTurnId.set(entry.turnId, items);
    }
    if (boundaryIndex > 0) {
      return { nextItemCursor: nextCursor, turns: hydrateTurns(turns, itemsByTurnId) };
    }
    if (nextCursor === null) {
      return { nextItemCursor: null, turns: hydrateTurns(turns, itemsByTurnId) };
    }
    assertAdvancingItemCursor(cursor, nextCursor, seenCursors);
    cursor = nextCursor;
  }
  return { nextItemCursor: null, turns: hydrateTurns(turns, itemsByTurnId) };
}

function hydrateTurns(
  turns: readonly Record<string, unknown>[],
  itemsByTurnId: ReadonlyMap<string, Record<string, unknown>[]>,
): unknown[] {
  return turns.map((turn) => {
    const turnId = expectString(turn["id"], "Codex turn id");
    return {
      ...turn,
      items: [...(itemsByTurnId.get(turnId) ?? [])].reverse(),
      itemsView: "full",
    };
  });
}

export async function readNativeTaskTurnPage(
  client: CodexRpcClient,
  threadId: string,
  historyMode: CodexThreadHistoryMode,
  turnCursor?: string,
  itemCursor?: string | null,
): Promise<NativeTaskTurnPage> {
  const response = expectRecord(
    await client.request("thread/turns/list", {
      ...(turnCursor === undefined ? {} : { cursor: turnCursor }),
      itemsView: historyMode === "paginated" ? "notLoaded" : "full",
      limit: TASK_TURN_PAGE_LIMIT,
      sortDirection: "desc",
      threadId,
    }),
    "thread/turns/list response",
  );
  if (!Array.isArray(response["data"])) {
    throw new CodexProtocolMappingError("thread/turns/list data must be an array");
  }
  const nativeTurns = response["data"].map((value) => {
    const turn = expectRecord(value, "Codex turn");
    if (historyMode === "legacy" && !Array.isArray(turn["items"])) {
      throw new CodexProtocolMappingError("Codex legacy turn items must be an array");
    }
    return turn;
  });
  const nextCursor = response["nextCursor"];
  const nextTurnCursor =
    nextCursor === null ? null : expectString(nextCursor, "thread/turns/list next cursor");
  if (nextTurnCursor !== null && (nextTurnCursor.length === 0 || nextTurnCursor === turnCursor)) {
    throw new CodexProtocolMappingError("thread/turns/list returned a repeated cursor");
  }
  const hydrated =
    historyMode === "paginated"
      ? await hydratePaginatedTurnItems(
          client,
          threadId,
          nativeTurns,
          itemCursor,
          nextTurnCursor !== null,
        )
      : { nextItemCursor: null, turns: nativeTurns };
  return {
    nextItemCursor: hydrated.nextItemCursor,
    nextTurnCursor,
    // Codex 默认返回 newest-first，Provider 边界统一恢复时间正序。
    turns: hydrated.turns.reverse(),
  };
}
