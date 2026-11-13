import {
  checkSearchCancellation,
  searchQuery,
  searchTextMatches,
  searchTextSnippet,
  type AgentCancellationSignal,
} from "@codexly/core";
import type { SearchOccurrencesPage, SearchOccurrencesQuery } from "@codexly/protocol";
import type { AcpHistory } from "./history.js";

interface Cursor {
  task: string;
  query: string;
  page: string;
  offset: number;
}
/** 只检索应用可见消息；分页固定在不可变投影上，不把思考、工具原始 JSON 或凭据当作正文。 */
export async function searchAcpHistory(
  history: AcpHistory,
  task: string,
  input: SearchOccurrencesQuery,
  signal?: AgentCancellationSignal,
  limit: 1 | 30 = 30,
): Promise<SearchOccurrencesPage> {
  checkSearchCancellation(signal);
  const query = searchQuery(input.query);
  let state: Cursor;
  if (input.cursor !== undefined) {
    try {
      if (input.cursor.length > 8192) throw new Error();
      const parsed: unknown = JSON.parse(input.cursor);
      if (!parsed || typeof parsed !== "object") throw new Error();
      const value = parsed as Cursor;
      if (
        value.task !== task ||
        value.query !== query ||
        typeof value.page !== "string" ||
        !Number.isSafeInteger(value.offset) ||
        value.offset < 0
      )
        throw new Error();
      state = value;
    } catch {
      throw new Error("无效 ACP 搜索游标");
    }
  } else {
    const page = await history.currentCursor(task);
    if (!page) return { data: [], nextCursor: null };
    state = { task, query, page, offset: 0 };
  }
  const visited = new Set<string>();
  for (;;) {
    checkSearchCancellation(signal);
    if (visited.has(state.page)) throw new Error("ACP 搜索分页无进展");
    visited.add(state.page);
    const page = await history.read(task, state.page);
    checkSearchCancellation(signal);
    const data: SearchOccurrencesPage["data"] = [];
    let offset = 0;
    for (const turn of page.turns)
      for (const item of turn.items) {
        if (item.type !== "message") continue;
        for (const match of searchTextMatches(item.text, query)) {
          if (offset++ < state.offset) continue;
          if (data.length === limit)
            return { data, nextCursor: JSON.stringify({ ...state, offset: offset - 1 }) };
          data.push({
            turnId: turn.id,
            itemId: item.id,
            turnCursor: state.page,
            ...searchTextSnippet(item.text, match.start, match.end),
          });
        }
      }
    if (data.length || !page.cursor)
      return {
        data,
        nextCursor: page.cursor
          ? JSON.stringify({ task, query, page: page.cursor, offset: 0 })
          : null,
      };
    state = { task, query, page: page.cursor, offset: 0 };
  }
}
