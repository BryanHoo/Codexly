import type { ReadAgentTaskInput } from "@codexly/core";

import {
  decodeItemContinuation,
  encodeItemContinuation,
  type PendingTurnItems,
} from "./task-item-cursor.js";

import type { CodexRpcClient } from "./agent-provider-base.js";
import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";

export const TASK_TURN_PAGE_LIMIT = 10;
const TASK_ITEM_PAGE_LIMIT = 100;
const MAX_TASK_TURN_CURSOR_BYTES = 8_192;

export type CodexThreadHistoryMode = "legacy" | "paginated";

export type TaskTurnCursorState = Readonly<{
  reviewItems?: readonly PendingReviewItems[];
  reviewCursor?: string | null;
  turnCursor?: string;
}>;

export type PendingReviewItems = Readonly<{
  cursor: string;
  parentTurnId: string;
  workerTaskId: string;
}>;

export type NativeTaskTurnPage = Readonly<{
  nextTurnCursor: string | null;
  turns: unknown[];
}>;

type NativeThreadItemEntry = Readonly<{
  completedAtMs?: number;
  item: Record<string, unknown>;
  startedAtMs?: number;
  turnId: string;
}>;

type NativeThreadItemPage = Readonly<{
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
    const reviewCursor = value["reviewCursor"];
    const turnCursor = value["turnCursor"];
    const rawReviewItems = value["reviewItems"];
    const reviewItems =
      rawReviewItems === undefined ? undefined : readPendingReviewItems(rawReviewItems);
    if (
      value["version"] !== 4 ||
      !(
        reviewCursor === undefined ||
        reviewCursor === null ||
        (typeof reviewCursor === "string" && reviewCursor.length > 0)
      ) ||
      !(
        (typeof turnCursor === "string" && turnCursor.length > 0) ||
        (turnCursor === null && reviewItems !== undefined && reviewItems.length > 0)
      )
    ) {
      throw new CodexProtocolMappingError("Task turn cursor is invalid");
    }
    return {
      ...(reviewCursor === undefined ? {} : { reviewCursor }),
      ...(reviewItems === undefined ? {} : { reviewItems }),
      ...(turnCursor === null ? {} : { turnCursor }),
    };
  } catch (error) {
    if (error instanceof CodexProtocolMappingError) {
      throw error;
    }
    throw new CodexProtocolMappingError("Task turn cursor is invalid");
  }
}

function readPendingReviewItems(value: unknown): PendingReviewItems[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > TASK_TURN_PAGE_LIMIT)
    throw new CodexProtocolMappingError("Task review item cursor is invalid");
  return value.map((entry) => {
    const record = expectRecord(entry, "Task review item cursor");
    const cursor = expectString(record["cursor"], "Task review item cursor");
    const parentTurnId = expectString(record["parentTurnId"], "Task review parent turn");
    const workerTaskId = expectString(record["workerTaskId"], "Task review worker");
    if (!cursor || !parentTurnId || !workerTaskId)
      throw new CodexProtocolMappingError("Task review item cursor is invalid");
    return { cursor, parentTurnId, workerTaskId };
  });
}

export function encodeTaskTurnCursor(
  turnCursor: string | null,
  reviewCursor: string | null | undefined,
  reviewItems: readonly PendingReviewItems[] = [],
): string | null {
  if (turnCursor === null && reviewItems.length === 0) {
    return null;
  }
  const encoded = Buffer.from(
    JSON.stringify({
      ...(reviewItems.length === 0 ? {} : { reviewItems }),
      reviewCursor,
      turnCursor,
      version: 4,
    }),
    "utf8",
  ).toString("base64url");
  if (Buffer.byteLength(encoded, "utf8") > MAX_TASK_TURN_CURSOR_BYTES)
    throw new CodexProtocolMappingError("Task turn cursor is too large");
  return encoded;
}

async function readThreadItemPage(
  client: CodexRpcClient,
  threadId: string,
  turnId: string,
  cursor: string | null | undefined,
  limit: number,
): Promise<NativeThreadItemPage> {
  const response = expectRecord(
    await client.request("thread/items/list", {
      ...(typeof cursor === "string" ? { cursor } : {}),
      limit,
      sortDirection: "desc",
      threadId,
      turnId,
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
  readCursor("backwardsCursor");
  return {
    entries: response["data"].map((value) => {
      const entry = expectRecord(value, "Codex thread item entry");
      const readTimestamp = (key: "startedAtMs" | "completedAtMs") => {
        const timestamp = entry[key];
        if (timestamp === null || timestamp === undefined) return undefined;
        if (!Number.isSafeInteger(timestamp) || (timestamp as number) < 0) {
          throw new CodexProtocolMappingError(`Codex thread item ${key} is invalid`);
        }
        return timestamp as number;
      };
      const completedAtMs = readTimestamp("completedAtMs");
      const startedAtMs = readTimestamp("startedAtMs");
      return {
        ...(completedAtMs === undefined ? {} : { completedAtMs }),
        item: expectRecord(entry["item"], "Codex thread item"),
        ...(startedAtMs === undefined ? {} : { startedAtMs }),
        turnId: expectString(entry["turnId"], "Codex thread item turn id"),
      };
    }),
    nextCursor: readCursor("nextCursor"),
  };
}

async function hydratePaginatedTurnItems(
  client: CodexRpcClient,
  threadId: string,
  turns: readonly Record<string, unknown>[],
  nextTurnCursor: string | null,
  cursors: ReadonlyMap<string, string> = new Map(),
): Promise<NativeTaskTurnPage> {
  // 每次请求每个 Turn 只取最近一页；剩余游标交给前端显式续页，首屏不追读。
  const pages = await Promise.all(
    turns.map(async (turn) => {
      const turnId = expectString(turn["id"], "Codex turn id");
      const cursor = cursors.get(turnId);
      const page = await readThreadItemPage(client, threadId, turnId, cursor, TASK_ITEM_PAGE_LIMIT);
      if (page.nextCursor !== null && page.nextCursor === cursor) {
        throw new CodexProtocolMappingError("thread/items/list returned a repeated cursor");
      }
      if (page.entries.length > TASK_ITEM_PAGE_LIMIT) {
        throw new CodexProtocolMappingError("thread/items/list exceeded the page limit");
      }
      const itemTimings: Record<string, { startedAtMs?: number; completedAtMs?: number }> = {};
      const items = page.entries
        .map((entry) => {
          if (entry.turnId !== turnId)
            throw new CodexProtocolMappingError("thread/items/list returned an unexpected turn");
          const itemId = expectString(entry.item["id"], "Codex thread item id");
          if (entry.startedAtMs !== undefined || entry.completedAtMs !== undefined) {
            itemTimings[itemId] = {
              ...(entry.startedAtMs === undefined ? {} : { startedAtMs: entry.startedAtMs }),
              ...(entry.completedAtMs === undefined ? {} : { completedAtMs: entry.completedAtMs }),
            };
          }
          return entry.item;
        })
        .reverse();
      return {
        cursor: page.nextCursor,
        turn: {
          ...turn,
          ...(Object.keys(itemTimings).length === 0 ? {} : { itemTimings }),
          items,
        },
      };
    }),
  );
  const pending: PendingTurnItems[] = pages.flatMap((page) =>
    page.cursor === null ? [] : [{ cursor: page.cursor, turn: page.turn }],
  );
  return {
    nextTurnCursor: encodeItemContinuation(threadId, nextTurnCursor, pending),
    turns: pages.map((page) => page.turn).reverse(),
  };
}

export async function readNativeTaskTurnPage(
  client: CodexRpcClient,
  threadId: string,
  historyMode: CodexThreadHistoryMode,
  turnCursor?: string,
): Promise<NativeTaskTurnPage> {
  const continuation = decodeItemContinuation(turnCursor, threadId);
  if (continuation !== undefined) {
    if (historyMode !== "paginated")
      throw new CodexProtocolMappingError("Task item pagination requires paginated history");
    return hydratePaginatedTurnItems(
      client,
      threadId,
      continuation.pending.map((entry) => entry.turn),
      continuation.nextTurnCursor,
      new Map(
        continuation.pending.map((entry) => [
          expectString(entry.turn["id"], "Pending turn id"),
          entry.cursor,
        ]),
      ),
    );
  }
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
  if (nativeTurns.length > TASK_TURN_PAGE_LIMIT)
    throw new CodexProtocolMappingError("thread/turns/list exceeded the page limit");
  if (historyMode === "paginated")
    return hydratePaginatedTurnItems(client, threadId, nativeTurns, nextTurnCursor);
  return {
    nextTurnCursor,
    // Codex 默认返回 newest-first，Provider 边界统一恢复时间正序。
    turns: nativeTurns.reverse(),
  };
}
