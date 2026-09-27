import { searchFiles as coordinateSearchFiles } from "@codexly/frontend-core";
import type { Project, ProjectFileSearchPage } from "@codexly/protocol";

import type { CodexlyProjectFileSearchClient } from "../projects/project-query-contracts.js";

export type SearchFile = ProjectFileSearchPage["data"][number] & {
  projectId: string;
  projectName: string;
};

export function searchFiles(
  client: CodexlyProjectFileSearchClient,
  projects: readonly Project[],
  query: string,
  signal: AbortSignal,
) {
  return coordinateSearchFiles(projects, query, signal, (...args) =>
    client.searchProjectFiles(...args),
  );
}
