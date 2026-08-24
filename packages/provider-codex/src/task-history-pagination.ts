import type { ReadAgentTaskInput } from "@codexly/core";

import type { CodexRpcClient } from "./agent-provider-base.js";
import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";

export const TASK_TURN_PAGE_LIMIT = 10;
const TASK_ITEM_PAGE_LIMIT = 100;
const MAX_TASK_TURN_CURSOR_BYTES = 8_192;

export type CodexThreadHistoryMode = "legacy" | "paginated";

export type TaskTurnCursorState = Readonly<{
  reviewCursor?: string | null;
  turnCursor?: string;
}>;

export type NativeTaskTurnPage = Readonly<{
  nextTurnCursor: string | null;
  turns: unknown[];
}>;

type NativeThreadItemEntry = Readonly<{
  item: Record<string, unknown>;
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
    if (
      value["version"] !== 4 ||
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
  reviewCursor: string | null | undefined,
): string | null {
  if (turnCursor === null) {
    return null;
  }
  return Buffer.from(JSON.stringify({ reviewCursor, turnCursor, version: 4 }), "utf8").toString(
    "base64url",
  );
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
): Promise<unknown[]> {
  // 每个 Turn 独立分页，避免延迟完成的旧 Item 打破线程级写入顺序。
  return Promise.all(
    turns.map(async (turn) => {
      const turnId = expectString(turn["id"], "Codex turn id");
      const items: Record<string, unknown>[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | null | undefined;
      while (cursor !== null) {
        const page = await readThreadItemPage(
          client,
          threadId,
          turnId,
          cursor,
          TASK_ITEM_PAGE_LIMIT,
        );
        for (const entry of page.entries) {
          if (entry.turnId !== turnId) {
            throw new CodexProtocolMappingError("thread/items/list returned an unexpected turn");
          }
          items.push(entry.item);
        }
        if (page.nextCursor === null) {
          break;
        }
        assertAdvancingItemCursor(cursor, page.nextCursor, seenCursors);
        cursor = page.nextCursor;
      }
      return {
        ...turn,
        items: items.reverse(),
        itemsView: "full",
      };
    }),
  );
}

export async function readNativeTaskTurnPage(
  client: CodexRpcClient,
  threadId: string,
  historyMode: CodexThreadHistoryMode,
  turnCursor?: string,
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
      ? await hydratePaginatedTurnItems(client, threadId, nativeTurns)
      : nativeTurns;
  return {
    nextTurnCursor,
    // Codex 默认返回 newest-first，Provider 边界统一恢复时间正序。
    turns: hydrated.reverse(),
  };
}
