import type { ProjectGitStatus } from "@code-agent/protocol";

import { i18n } from "../../../i18n/i18n.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import { CommitChangesController } from "./commit-changes-controller.js";

export function WorkbenchInspectorChanges({
  client,
  detailsError,
  detailsPending,
  detailsStatus,
  gitStatus,
  gitStatusError,
  onOpenFileDiff,
  projectId,
  rootPath,
}: Readonly<{
  client: CodeAgentWorkbenchClient | undefined;
  detailsError: Error | null;
  detailsPending: boolean;
  detailsStatus: ProjectGitStatus | undefined;
  gitStatus: ProjectGitStatus | undefined;
  gitStatusError: Error | null;
  onOpenFileDiff: (change: AgentFileChange) => void;
  projectId: string | undefined;
  rootPath: string;
}>) {
  if (projectId !== undefined && client !== undefined && gitStatus !== undefined) {
    return (
      <CommitChangesController
        client={client}
        detailsError={detailsError}
        detailsPending={detailsPending}
        gitStatus={detailsStatus ?? gitStatus}
        onOpenFileDiff={onOpenFileDiff}
        projectId={projectId}
        rootPath={rootPath}
      />
    );
  }
  if (gitStatusError !== null) {
    return (
      <p className="p-3 text-caption text-danger" role="alert">
        {gitStatusError.message}
      </p>
    );
  }
  return (
    <p className="p-3 text-caption text-muted-foreground" role="status">
      {i18n.t("inspector.gitLoading", { ns: "conversation" })}
    </p>
  );
}
