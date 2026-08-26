import type { ProjectFileSearchEntry, ProjectOpenApp, ProjectOpenAppId } from "@codexly/protocol";

import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodexlyFileTreeClient } from "../../projects/project-query-contracts.js";

export type WorkbenchProjectFileTreeProps = Readonly<{
  client: CodexlyFileTreeClient;
  expandedPaths: ReadonlySet<string>;
  fileChangesByPath: ReadonlyMap<string, AgentFileChange>;
  onExpandedPathsChange: (paths: Set<string>) => void;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenProjectFile: (path: string) => void;
  onOpenProjectPath: (appId: ProjectOpenAppId, path?: string) => void;
  onReferenceProjectPath: (entry: ProjectFileSearchEntry) => void;
  onRefreshProject: () => unknown;
  projectId: string;
  projectName: string;
  projectRootId: string;
  projectOpenApps: readonly ProjectOpenApp[];
  projectOpenPending: boolean;
  projectPath: string;
  projectRefreshing?: boolean;
}>;
