import type {
  ProjectFileSearchEntry,
  ProjectFileTree,
  ProjectOpenApp,
  ProjectOpenAppId,
} from "@codexly/protocol";
import type { ItemInstance } from "@headless-tree/core";

import type { CodexlyFileTreeClient } from "../../projects/project-query-contracts.js";
import type { collectVisibleProjectFileTreeChangeStats } from "./project-file-tree-changes.js";
import type { ProjectFileTreeItem } from "./project-file-tree-model.js";

export type ProjectFileTreeRowProps = Readonly<{
  changeStatsByPath: ReturnType<typeof collectVisibleProjectFileTreeChangeStats>;
  client: CodexlyFileTreeClient;
  item: ItemInstance<ProjectFileTreeItem>;
  onOpenProjectPath: (appId: ProjectOpenAppId, path?: string) => void;
  onReferenceProjectPath: (entry: ProjectFileSearchEntry) => void;
  onRefreshDirectory: (path: string | null, serverTree?: ProjectFileTree) => void;
  onRefreshProject: () => unknown;
  onSelect: (id: string) => void;
  projectOpenApps: readonly ProjectOpenApp[];
  projectOpenPending: boolean;
  projectId: string;
  projectPath: string;
  projectRootId: string;
  projectRefreshing: boolean;
}>;
