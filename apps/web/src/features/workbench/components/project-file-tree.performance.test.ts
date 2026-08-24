import { buildProxiedInstance, createTree, syncDataLoaderFeature } from "@headless-tree/core";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import performanceBudgets from "../../../../../../tests/performance-budgets.json" with { type: "json" };
import {
  createProjectFileTreeDataLoader,
  PROJECT_FILE_TREE_PROJECT_ROOT_ID,
  PROJECT_FILE_TREE_ROOT_ID,
  type ProjectFileTreeItem,
} from "./project-file-tree-model.js";
import { getProjectFileTreeMaximumMountedRows } from "./project-file-tree-changes.js";

describe("project file tree performance", () => {
  it("builds 10,000 flat items while keeping mounted rows bounded", async () => {
    const { items, maxBuildMs, maxHeapGrowthBytes, maxMountedRows, viewportHeight } =
      performanceBudgets.fileTree;
    const entries = Array.from({ length: items }, (_, index) => ({
      path: `file-${String(index).padStart(5, "0")}.ts`,
      type: "file" as const,
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const loader = createProjectFileTreeDataLoader({
      client: {
        listProjectFiles: vi.fn(() => Promise.resolve({ entries, path: null })),
      },
      projectId: "performance-project",
      projectName: "Performance Project",
      queryClient,
      rootPath: "/workspace/Performance",
    });

    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const projectRoots = await loader.getChildrenWithData(PROJECT_FILE_TREE_ROOT_ID);
    const children = await loader.getChildrenWithData(PROJECT_FILE_TREE_PROJECT_ROOT_ID);
    const itemData = new Map([...projectRoots, ...children].map(({ data, id }) => [id, data]));
    itemData.set(PROJECT_FILE_TREE_ROOT_ID, await loader.getItem(PROJECT_FILE_TREE_ROOT_ID));
    const tree = createTree<ProjectFileTreeItem>({
      dataLoader: {
        getChildren: (itemId) =>
          itemId === PROJECT_FILE_TREE_ROOT_ID
            ? projectRoots.map(({ id }) => id)
            : itemId === PROJECT_FILE_TREE_PROJECT_ROOT_ID
              ? children.map(({ id }) => id)
              : [],
        getItem: (itemId) => {
          const data = itemData.get(itemId);
          if (data === undefined) throw new Error(`Missing performance item: ${itemId}`);
          return data;
        },
      },
      features: [syncDataLoaderFeature],
      getItemName: (item) => {
        const data = item.getItemData();
        return data.kind === "status" ? "status" : data.name;
      },
      initialState: { expandedItems: [PROJECT_FILE_TREE_PROJECT_ROOT_ID] },
      instanceBuilder: buildProxiedInstance,
      isItemFolder: (item) => item.getItemData().type === "directory",
      rootItemId: PROJECT_FILE_TREE_ROOT_ID,
    });
    tree.setMounted(true);
    tree.rebuildTree();
    const buildDurationMs = performance.now() - startedAt;
    globalThis.gc?.();
    const heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

    expect(tree.getItems()).toHaveLength(items + 1);
    expect(getProjectFileTreeMaximumMountedRows(items, viewportHeight)).toBeLessThanOrEqual(
      maxMountedRows,
    );
    expect(buildDurationMs).toBeLessThan(maxBuildMs);
    expect(heapGrowthBytes).toBeLessThan(maxHeapGrowthBytes);
  });
});
