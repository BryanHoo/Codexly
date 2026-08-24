import type { ProjectFileTreeEntry } from "@codexly/protocol";
import type { QueryClient } from "@tanstack/react-query";

import type { CodexlyFileTreeClient } from "../../projects/project-query-contracts.js";
import { projectFileTreeQueryOptions } from "../../projects/project-query-options.js";

export const PROJECT_FILE_TREE_ROOT_ID = "\0project-file-tree-root";
export const PROJECT_FILE_TREE_PROJECT_ROOT_ID = "\0project-file-tree-project-root";
const PROJECT_FILE_TREE_STATUS_PREFIX = "\0project-file-tree-status:";

export type ProjectFileTreeItem =
  | Readonly<{
      kind: "root";
      name: string;
      type: "directory";
    }>
  | Readonly<{
      kind: "entry";
      name: string;
      path: string;
      type: ProjectFileTreeEntry["type"];
    }>
  | Readonly<{
      directoryPath: string | null;
      kind: "status";
      message?: string;
      name: string;
      status: "empty" | "error";
      type: "status";
    }>;

type ProjectFileTreeDataLoaderOptions = Readonly<{
  client: CodexlyFileTreeClient;
  projectId: string;
  projectName: string;
  queryClient: QueryClient;
  rootPath: string;
}>;

function getProjectFileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function getProjectFileTreeItemId(entry: ProjectFileTreeEntry): string {
  return entry.path;
}

function getStatusItemId(directoryPath: string | null, status: "empty" | "error"): string {
  return `${PROJECT_FILE_TREE_STATUS_PREFIX}${status}:${directoryPath ?? "root"}`;
}

function createEntryItem(entry: ProjectFileTreeEntry): ProjectFileTreeItem {
  return {
    kind: "entry",
    name: getProjectFileName(entry.path),
    path: entry.path,
    type: entry.type,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createProjectFileTreeDataLoader({
  client,
  projectId,
  projectName,
  queryClient,
  rootPath,
}: ProjectFileTreeDataLoaderOptions) {
  const items = new Map<string, ProjectFileTreeItem>();
  const rootItem: ProjectFileTreeItem = { kind: "root", name: projectName, type: "directory" };
  items.set(PROJECT_FILE_TREE_PROJECT_ROOT_ID, rootItem);

  return {
    async getChildrenWithData(itemId: string) {
      // Headless Tree 隐藏 rootItemId，额外注入一层才能稳定渲染项目根节点及其操作。
      if (itemId === PROJECT_FILE_TREE_ROOT_ID) {
        return [{ data: rootItem, id: PROJECT_FILE_TREE_PROJECT_ROOT_ID }];
      }
      const item = items.get(itemId);
      if (item?.type === "file" || item?.type === "status") return [];
      const directoryPath = itemId === PROJECT_FILE_TREE_PROJECT_ROOT_ID ? null : itemId;

      try {
        const listing = await queryClient.fetchQuery(
          projectFileTreeQueryOptions(projectId, rootPath, directoryPath, client),
        );
        if (listing.entries.length === 0) {
          const id = getStatusItemId(directoryPath, "empty");
          const data: ProjectFileTreeItem = {
            directoryPath,
            kind: "status",
            name: directoryPath === null ? projectName : getProjectFileName(directoryPath),
            status: "empty",
            type: "status",
          };
          items.set(id, data);
          return [{ data, id }];
        }

        return listing.entries.map((entry) => {
          const id = getProjectFileTreeItemId(entry);
          const data = createEntryItem(entry);
          items.set(id, data);
          return { data, id };
        });
      } catch (error) {
        // Headless Tree 1.7 不清理 rejected Loader，错误必须成为可渲染状态节点。
        const id = getStatusItemId(directoryPath, "error");
        const data: ProjectFileTreeItem = {
          directoryPath,
          kind: "status",
          message: getErrorMessage(error),
          name: directoryPath === null ? projectName : getProjectFileName(directoryPath),
          status: "error",
          type: "status",
        };
        items.set(id, data);
        return [{ data, id }];
      }
    },
    getItem(itemId: string): Promise<ProjectFileTreeItem> {
      return Promise.resolve(
        items.get(itemId) ?? {
          kind: "entry",
          name: getProjectFileName(itemId),
          path: itemId,
          type: "directory",
        },
      );
    },
  };
}
