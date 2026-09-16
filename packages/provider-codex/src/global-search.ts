import type { AgentSearchProvider, AgentSearchScope } from "@codexly/core";
import type {
  SearchOccurrence,
  SearchOccurrencesPage,
  SearchOccurrencesQuery,
  TaskSearchPage,
  TaskSearchQuery,
} from "@codexly/protocol";

import type { CodexRpcClient } from "./codex-rpc-client.js";
import {
  CodexProtocolMappingError,
  expectRecord,
  expectString,
  mapAgentTask,
} from "./codex-protocol-mapping.js";
import { isProjectThread } from "./codex-task-mapping.js";
import { encodeTaskTurnCursor } from "./task-history-pagination.js";

const SEARCH_PAGE_SIZE = 30;
const HISTORY_OCCURRENCE_CONCURRENCY = 4;

type NativePage = Readonly<{ data: readonly unknown[]; nextCursor: string | null }>;

function validateQuery(value: string): string {
  const query = value.trim();
  if (query.length === 0 || Array.from(query).length > 1_024) {
    throw new CodexProtocolMappingError("Global search query is invalid");
  }
  return query;
}

function parsePage(value: unknown, label: string): NativePage {
  const page = expectRecord(value, label);
  if (!Array.isArray(page["data"])) {
    throw new CodexProtocolMappingError(`${label} data must be an array`);
  }
  const nextCursor = page["nextCursor"];
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw new CodexProtocolMappingError(`${label} nextCursor must be a string or null`);
  }
  return { data: page["data"], nextCursor };
}

function parseOccurrence(value: unknown): SearchOccurrence {
  const occurrence = expectRecord(value, "thread/searchOccurrences item");
  const range = expectRecord(
    occurrence["snippetMatchRange"],
    "thread/searchOccurrences snippetMatchRange",
  );
  const start = range["start"];
  const end = range["end"];
  if (!Number.isInteger(start) || !Number.isInteger(end) || Number(start) < 0 || Number(end) < 0) {
    throw new CodexProtocolMappingError("thread/searchOccurrences range must be non-negative");
  }
  const nativeTurnCursor = expectString(
    occurrence["turnCursor"],
    "thread/searchOccurrences turnCursor",
  );
  // 搜索接口返回 Codex 原生游标；HTTP readTask 使用版本化公共游标，必须在 Provider 边界转换。
  const turnCursor = encodeTaskTurnCursor(nativeTurnCursor, undefined);
  if (turnCursor === null) {
    throw new CodexProtocolMappingError("thread/searchOccurrences turnCursor must not be null");
  }
  return {
    itemId: expectString(occurrence["itemId"], "thread/searchOccurrences itemId"),
    snippet: expectString(occurrence["snippet"], "thread/searchOccurrences snippet"),
    snippetMatchRange: { end: Number(end), start: Number(start) },
    turnCursor,
    turnId: expectString(occurrence["turnId"], "thread/searchOccurrences turnId"),
  };
}

function scopeForThread(
  thread: Record<string, unknown>,
  scopes: readonly AgentSearchScope[],
): AgentSearchScope | undefined {
  return scopes.find((scope) => isProjectThread(thread, scope));
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  const entries = values.entries();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      let entry = entries.next();
      while (!entry.done) {
        const [index, value] = entry.value;
        results[index] = await map(value);
        entry = entries.next();
      }
    }),
  );
  return results;
}

export class CodexGlobalSearchService implements AgentSearchProvider {
  public constructor(private readonly client: CodexRpcClient) {}

  public async searchTasks(
    input: TaskSearchQuery,
    scopes: readonly AgentSearchScope[],
  ): Promise<TaskSearchPage> {
    const query = validateQuery(input.query);
    const params = {
      archived: input.archived,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: SEARCH_PAGE_SIZE,
      searchTerm: query,
      sortDirection: "desc",
      sortKey: "recency_at",
    };
    const page = parsePage(
      await this.client.request(
        input.kind === "tasks" ? "thread/list" : "thread/search",
        input.kind === "tasks" ? { ...params, modelProviders: [] } : params,
      ),
      input.kind === "tasks" ? "thread/list response" : "thread/search response",
    );
    const mapped = await mapWithConcurrency(
      page.data.slice(0, SEARCH_PAGE_SIZE),
      input.kind === "history" ? HISTORY_OCCURRENCE_CONCURRENCY : SEARCH_PAGE_SIZE,
      async (value): Promise<TaskSearchPage["data"][number] | undefined> => {
        const result =
          input.kind === "tasks" ? { thread: value } : expectRecord(value, "thread/search item");
        const thread = expectRecord(result["thread"], "global search thread");
        const scope = scopeForThread(thread, scopes);
        if (scope === undefined) return undefined;
        const task = await mapAgentTask(thread, scope);
        if (input.kind === "tasks") return { snippet: "", task };

        // 原生全文结果可能命中过过程消息，仅保留当前可定位的可见消息。
        const occurrences = await this.requestOccurrences(task.id, query, undefined, 1);
        const occurrence = occurrences.data[0];
        if (occurrence === undefined) return undefined;
        return { occurrence, snippet: occurrence.snippet, task };
      },
    );
    return { data: mapped.filter((item) => item !== undefined), nextCursor: page.nextCursor };
  }

  public async searchTaskOccurrences(
    taskId: string,
    input: SearchOccurrencesQuery,
    scope: AgentSearchScope,
  ): Promise<SearchOccurrencesPage> {
    const query = validateQuery(input.query);
    const response = expectRecord(
      await this.client.request("thread/read", { includeTurns: false, threadId: taskId }),
      "thread/read response",
    );
    const thread = expectRecord(response["thread"], "thread/read thread");
    if (!isProjectThread(thread, scope)) {
      throw new CodexProtocolMappingError("Search task does not belong to the requested project");
    }
    return this.requestOccurrences(taskId, query, input.cursor, SEARCH_PAGE_SIZE);
  }

  private async requestOccurrences(
    taskId: string,
    query: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<SearchOccurrencesPage> {
    const page = parsePage(
      await this.client.request("thread/searchOccurrences", {
        ...(cursor === undefined ? {} : { cursor }),
        limit,
        searchTerm: query,
        threadId: taskId,
      }),
      "thread/searchOccurrences response",
    );
    return { data: page.data.map(parseOccurrence), nextCursor: page.nextCursor };
  }
}
