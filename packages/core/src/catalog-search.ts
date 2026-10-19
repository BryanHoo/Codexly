import type {
  AgentEngine,
  SearchOccurrencesPage,
  SearchOccurrencesQuery,
  TaskSearchPage,
  TaskSearchQuery,
} from "@codexly/protocol";
import type {
  AgentCancellationSignal,
  AgentSearchProvider,
  AgentSearchScope,
} from "./agent-provider.js";
import type { LocalCatalogStore, LocalTask } from "./local-catalog.js";
import { localTaskMetadata } from "./engine-router.js";

export function checkSearchCancellation(signal?: AgentCancellationSignal): void {
  if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
}

export function searchQuery(value: string): string {
  const query = value.trim();
  if (!query || query.length > 1024) throw new Error("Invalid search query");
  return query;
}

export function catalogSearchCursor(input: TaskSearchQuery): string | undefined {
  if (input.cursor === undefined) return undefined;
  const value = JSON.parse(input.cursor) as Record<string, unknown>;
  if (
    input.cursor.length > 8192 ||
    value["version"] !== 1 ||
    value["query"] !== input.query ||
    value["kind"] !== input.kind ||
    value["archived"] !== input.archived ||
    value["engines"] !== (input.engines ?? "codex,claude") ||
    typeof value["catalog"] !== "string"
  )
    throw new Error("Invalid search cursor");
  return value["catalog"];
}

/** 统一目录负责两种引擎的排序、标题及归档状态；执行引擎只负责可见正文检索。 */
export class CatalogSearchService implements AgentSearchProvider {
  constructor(
    readonly store: LocalCatalogStore,
    readonly occurrences: (
      task: LocalTask,
      input: SearchOccurrencesQuery,
      signal?: AgentCancellationSignal,
      limit?: 1 | 30,
    ) => Promise<SearchOccurrencesPage>,
  ) {}

  async searchTasks(
    input: TaskSearchQuery,
    scopes: readonly AgentSearchScope[],
    signal?: AgentCancellationSignal,
  ): Promise<TaskSearchPage> {
    let current = input;
    for (;;) {
      const page = await this.#searchPage(current, scopes, signal);
      if (page.data.length || page.unavailableEngines?.length || page.nextCursor === null)
        return page;
      // 任务候选不等于全文命中；跳过空候选页，避免更早的匹配被误报为无结果。
      if (page.nextCursor === current.cursor) throw new Error("Repeated search cursor");
      current = { ...input, cursor: page.nextCursor };
    }
  }

  async #searchPage(
    input: TaskSearchQuery,
    scopes: readonly AgentSearchScope[],
    signal?: AgentCancellationSignal,
  ): Promise<TaskSearchPage> {
    checkSearchCancellation(signal);
    const query = searchQuery(input.query);
    const cursor = catalogSearchCursor(input);
    const page = await this.store.catalog("task.list", {
      archived: input.archived,
      ...(input.engines === undefined
        ? {}
        : { providers: input.engines.split(",") as ("codex" | "claude")[] }),
      limit: input.kind === "history" ? 10 : 30,
      ...(cursor === undefined ? {} : { cursor }),
      ...(input.kind === "tasks" ? { searchTerm: query } : {}),
    });
    checkSearchCancellation(signal);
    const data = new Array<TaskSearchPage["data"][number] | undefined>(page.data.length);
    const unavailable = new Set<AgentEngine>();
    const entries = page.data.entries();
    // 固定四个槽位，既保留本地排序，也限制双引擎历史 I/O 峰值。
    await Promise.all(
      Array.from({ length: Math.min(4, page.data.length) }, async () => {
        for (const [index, task] of entries) {
          checkSearchCancellation(signal);
          if (
            !scopes.some(
              (scope) => task.projectId === (scope.kind === "temporary" ? null : scope.id),
            )
          )
            continue;
          if (task.provider !== "codex" && task.provider !== "claude") continue;
          const metadata = localTaskMetadata(task);
          if (input.kind === "tasks") {
            data[index] = { task: metadata, snippet: "" };
            continue;
          }
          try {
            const result = await this.occurrences(task, { query }, signal, 1);
            const occurrence = result.data[0];
            if (occurrence)
              data[index] = { task: metadata, snippet: occurrence.snippet, occurrence };
          } catch (error) {
            checkSearchCancellation(signal);
            if (error instanceof Error && error.name === "AbortError") throw error;
            // 单个引擎故障不能吞掉另一个引擎的命中；显式返回失败源供界面提示。
            unavailable.add(task.provider);
          }
        }
      }),
    );
    checkSearchCancellation(signal);
    // 空候选页也保留续页，不能因当前十个任务未命中就漏掉更早历史。
    return {
      data: data.filter((item) => item !== undefined),
      ...(unavailable.size ? { unavailableEngines: [...unavailable].sort() } : {}),
      nextCursor:
        page.nextCursor === null
          ? null
          : JSON.stringify({
              version: 1,
              query: input.query,
              kind: input.kind,
              archived: input.archived,
              engines: input.engines ?? "codex,claude",
              catalog: page.nextCursor,
            }),
    };
  }

  async searchTaskOccurrences(
    taskId: string,
    input: SearchOccurrencesQuery,
    scope: AgentSearchScope,
    signal?: AgentCancellationSignal,
  ): Promise<SearchOccurrencesPage> {
    checkSearchCancellation(signal);
    searchQuery(input.query);
    const task = await this.store.catalog("task.read", { id: taskId });
    checkSearchCancellation(signal);
    if (!task || task.projectId !== (scope.kind === "temporary" ? null : scope.id))
      throw new Error("Search task does not belong to the requested project");
    return this.occurrences(task, input, signal);
  }
}
