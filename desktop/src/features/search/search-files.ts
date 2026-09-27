import { searchFiles as coordinateSearchFiles } from "@codexly/frontend-core";
import type { Project, ProjectFileSearchPage } from "@/protocol/index.js";

import type { NativeProjectFileSearchClient } from "../projects/project-query-contracts.js";

export type SearchFile = ProjectFileSearchPage["data"][number] & {
  projectId: string;
  projectName: string;
};

export function searchFiles(
  client: NativeProjectFileSearchClient,
  projects: readonly Project[],
  query: string,
  signal: AbortSignal,
) {
  return coordinateSearchFiles(projects, query, signal, (...args) =>
    client.searchProjectFiles(...args));
}
