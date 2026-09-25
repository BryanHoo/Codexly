import type { ProjectFileSearchEntry, ProjectOpenApp, ProjectOpenAppId } from "@/protocol/index.js";

import type { AgentFileChange } from "../../diff/file-change.js";
import type { NativeFileTreeClient } from "../../projects/project-query-contracts.js";

export type WorkbenchProjectFileTreeProps = Readonly<{
  client: NativeFileTreeClient;
  expandedPaths: ReadonlySet<string>;
  fileChangesByPath: ReadonlyMap<string, AgentFileChange>;
  onExpandedPathsChange: (paths: Set<string>) => void;
  onOpenProjectFile: (path: string, change?: AgentFileChange) => void;
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
