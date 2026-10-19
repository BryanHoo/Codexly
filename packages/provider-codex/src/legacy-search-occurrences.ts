import { searchTextMatches as matches, searchTextSnippet as snippet } from "@codexly/core";
import type { AgentCancellationSignal } from "@codexly/core";
import type { SearchOccurrence, SearchOccurrencesPage } from "@codexly/protocol";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";
import { encodeTaskTurnCursor } from "./task-history-pagination.js";
import { throwIfRpcAborted } from "./rpc-cancellation.js";

const PREFIX = "codexly-search-v1:";
interface Cursor {
  threadId: string;
  query: string;
  turnCursor: string | null;
  offset: number;
}

export function isLegacySearchCursor(cursor: string | undefined): boolean {
  return cursor?.startsWith(PREFIX) === true;
}

function decodeCursor(cursor: string | undefined, threadId: string, query: string): Cursor {
  if (cursor === undefined) return { threadId, query, turnCursor: null, offset: 0 };
  try {
    const value = expectRecord(JSON.parse(cursor.slice(PREFIX.length)), "Legacy search cursor");
    if (
      !isLegacySearchCursor(cursor) ||
      cursor.length > 8192 ||
      value["threadId"] !== threadId ||
      value["query"] !== query ||
      !(value["turnCursor"] === null || typeof value["turnCursor"] === "string") ||
      !Number.isSafeInteger(value["offset"]) ||
      Number(value["offset"]) < 0
    )
      throw new Error();
    return { threadId, query, turnCursor: value["turnCursor"], offset: Number(value["offset"]) };
  } catch {
    throw new CodexProtocolMappingError("Legacy search cursor is invalid");
  }
}

function visibleText(item: Record<string, unknown>): string | undefined {
  if (item["type"] === "agentMessage" && item["phase"] !== "commentary") {
    return expectString(item["text"], "Search message text");
  }
  if (item["type"] !== "userMessage" || !Array.isArray(item["content"])) return undefined;
  return item["content"]
    .flatMap((part: unknown) => {
      const content = expectRecord(part, "Search message content");
      return content["type"] === "text" ? [expectString(content["text"], "Search user text")] : [];
    })
    .join("");
}

export async function searchLegacyOccurrences(
  client: CodexRpcClient,
  threadId: string,
  query: string,
  cursor: string | undefined,
  limit: number,
  signal?: AgentCancellationSignal,
): Promise<SearchOccurrencesPage> {
  let state = decodeCursor(cursor, threadId, query);
  const visited = new Set<string | null>();
  for (;;) {
    throwIfRpcAborted(signal);
    if (visited.has(state.turnCursor))
      throw new CodexProtocolMappingError("Legacy search returned a repeated cursor");
    visited.add(state.turnCursor);
    // 每次只读取十个回合，在后端匹配；Web 和移动端只接收摘要，不加载整段历史。
    const page = expectRecord(
      await client.request(
        "thread/turns/list",
        {
          ...(state.turnCursor === null ? {} : { cursor: state.turnCursor }),
          itemsView: "full",
          limit: 10,
          sortDirection: "desc",
          threadId,
        },
        undefined,
        signal,
      ),
      "Legacy search turns page",
    );
    throwIfRpcAborted(signal);
    if (
      !Array.isArray(page["data"]) ||
      page["data"].length > 10 ||
      !(page["nextCursor"] === null || typeof page["nextCursor"] === "string")
    ) {
      throw new CodexProtocolMappingError("Legacy search turns page is invalid");
    }
    const data: SearchOccurrence[] = [];
    let offset = 0;
    for (const value of page["data"]) {
      const turn = expectRecord(value, "Search turn");
      if (!Array.isArray(turn["items"]))
        throw new CodexProtocolMappingError("Search turn items are invalid");
      for (const raw of turn["items"]) {
        const item = expectRecord(raw, "Search item");
        const text = visibleText(item);
        if (text === undefined) continue;
        for (const match of matches(text, query)) {
          if (offset++ < state.offset) continue;
          // 使用服务端返回的 inclusive 页锚点，后续十回合定位页必定包含命中回合。
          const anchor = expectString(page["backwardsCursor"], "Search page anchor");
          if (data.length === limit)
            return {
              data,
              nextCursor:
                PREFIX + JSON.stringify({ ...state, turnCursor: anchor, offset: offset - 1 }),
            };
          const turnCursor = encodeTaskTurnCursor(anchor, undefined);
          if (turnCursor === null)
            throw new CodexProtocolMappingError("Search page anchor is empty");
          data.push({
            itemId: expectString(item["id"], "Search item id"),
            turnId: expectString(turn["id"], "Search turn id"),
            turnCursor,
            ...snippet(text, match.start, match.end),
          });
        }
      }
    }
    const next = page["nextCursor"];
    if (next !== null && visited.has(next))
      throw new CodexProtocolMappingError("Legacy search returned a repeated cursor");
    state = { threadId, query, turnCursor: next, offset: 0 };
    if (data.length > 0 || next === null)
      return { data, nextCursor: next === null ? null : PREFIX + JSON.stringify(state) };
  }
}
