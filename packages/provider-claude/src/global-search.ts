import {
  checkSearchCancellation,
  searchQuery,
  searchTextMatches,
  searchTextSnippet,
  type AgentCancellationSignal,
} from "@codexly/core";
import type {
  SearchOccurrence,
  SearchOccurrencesPage,
  SearchOccurrencesQuery,
} from "@codexly/protocol";
import type { ClaudeHistory } from "./history.js";

const PREFIX = "claude-search:";
interface Cursor {
  task: string;
  query: string;
  page: string | null;
  offset: number;
}

/** 仅分页读取已有摘要，不启动 SDK、不读取推理和工具正文，也不维护额外常驻索引。 */
export async function searchClaudeOccurrences(
  history: ClaudeHistory,
  task: string,
  input: SearchOccurrencesQuery,
  signal?: AgentCancellationSignal,
  limit = 30,
): Promise<SearchOccurrencesPage> {
  const query = searchQuery(input.query);
  let state: Cursor = { task, query, page: null, offset: 0 };
  if (input.cursor !== undefined) {
    if (!input.cursor.startsWith(PREFIX) || input.cursor.length > 8192)
      throw new Error("Invalid Claude search cursor");
    state = JSON.parse(input.cursor.slice(PREFIX.length)) as Cursor;
    if (
      state.task !== task ||
      state.query !== query ||
      !(state.page === null || typeof state.page === "string") ||
      !Number.isSafeInteger(state.offset) ||
      state.offset < 0
    )
      throw new Error("Invalid Claude search cursor");
  }
  const visited = new Set<string | null>();
  for (;;) {
    checkSearchCancellation(signal);
    if (visited.has(state.page)) throw new Error("Repeated Claude search cursor");
    visited.add(state.page);
    const page = await history.readSummary(task, state.page ?? undefined);
    checkSearchCancellation(signal);
    const data: SearchOccurrence[] = [];
    let offset = 0;
    // 用摘要索引的 inclusive 锚点固定本页；新回合到来后续查仍不重排旧命中。
    const latest = page.turns.at(-1);
    const anchor = latest === undefined ? undefined : page.resume.get(latest.id);
    for (const turn of [...page.turns].reverse()) {
      for (const item of turn.items) {
        if (item.type !== "message") continue;
        for (const match of searchTextMatches(item.text, query)) {
          if (offset++ < state.offset) continue;
          if (data.length === limit)
            return {
              data,
              nextCursor:
                PREFIX + JSON.stringify({ task, query, page: anchor, offset: offset - 1 }),
            };
          const turnCursor = page.resume.get(turn.id);
          if (!turnCursor) throw new Error("Claude search anchor is unavailable");
          data.push({
            itemId: item.id,
            turnId: turn.id,
            turnCursor,
            ...searchTextSnippet(item.text, match.start, match.end),
          });
        }
      }
    }
    if (data.length || page.cursor === null)
      return {
        data,
        nextCursor:
          page.cursor === null
            ? null
            : PREFIX + JSON.stringify({ task, query, page: page.cursor, offset: 0 }),
      };
    state = { task, query, page: page.cursor, offset: 0 };
  }
}
