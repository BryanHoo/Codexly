import type { ProjectFileSearchEntry, ProjectRoot } from "@code-agent/protocol";

import type { ProjectFileTreeItem } from "./project-file-tree-model.js";
import {
  getProjectTargetAbsolutePath,
  type ProjectOpenContextMenuTarget,
} from "./project-open-menu.js";

export function createProjectFileTreeOpenTarget(
  item: ProjectFileTreeItem,
  projectRoot: Pick<ProjectRoot, "id" | "path">,
): ProjectOpenContextMenuTarget | null {
  if (item.kind === "status") return null;
  if (item.kind === "root") {
    return {
      absolutePath: projectRoot.path,
      path: projectRoot.path,
      relativePath: ".",
      type: "directory",
    };
  }
  return {
    absolutePath: getProjectTargetAbsolutePath(projectRoot.path, item.path),
    path: item.path,
    relativePath: item.path,
    ...(item.type === "file"
      ? {
          reference: {
            name: item.name,
            path: item.path,
            rootId: projectRoot.id,
            rootPath: projectRoot.path,
          } satisfies ProjectFileSearchEntry,
        }
      : {}),
    type: item.type,
  };
}
