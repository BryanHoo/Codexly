import type { ProjectGitStatus } from "@codexly/protocol";
import type { QueryClient } from "@tanstack/react-query";

import type { AgentFileChange } from "../diff/file-change.js";
import {
  projectGitDetailedStatusQueryOptions,
  type CodexlyGitStatusClient,
} from "../projects/project-queries.js";

export async function loadProjectGitFileDiff(
  queryClient: QueryClient,
  client: CodexlyGitStatusClient,
  projectId: string,
  rootPath: string,
  summary: ProjectGitStatus | undefined,
  change: AgentFileChange,
): Promise<AgentFileChange> {
  if (summary === undefined || change.diff !== "") return change;

  const location = summary.unstaged.includes(change) ? "unstaged" : "staged";
  const details = await queryClient.fetchQuery(
    projectGitDetailedStatusQueryOptions(projectId, rootPath, null, summary.snapshot, true, client),
  );
  return (
    details[location].find(
      (candidate) => candidate.path === change.path && candidate.kind === change.kind,
    ) ?? change
  );
}
