import {
  SearchOccurrencesPageSchema,
  TaskSearchPageSchema,
  type SearchOccurrencesPage,
  type TaskSearchPage,
  type TaskSearchQuery,
} from "@codexly/protocol";

import { TaskCatalogHttpClient } from "./http-client-task-catalog.js";
import { appendQuery, taskPath, type ReadOptions } from "./http-client-transport.js";

export class GlobalSearchHttpClient extends TaskCatalogHttpClient {
  public async searchTasks(
    input: TaskSearchQuery,
    options: ReadOptions = {},
  ): Promise<TaskSearchPage> {
    return this.read(appendQuery("/v1/search/tasks", input), TaskSearchPageSchema, options);
  }

  public async searchTaskOccurrences(
    projectId: string,
    taskId: string,
    query: string,
    cursor?: string,
    options: ReadOptions = {},
  ): Promise<SearchOccurrencesPage> {
    return this.read(
      appendQuery(`${taskPath(projectId, taskId)}/search-occurrences`, { cursor, query }),
      SearchOccurrencesPageSchema,
      options,
    );
  }
}
