import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  PROJECT_FILE_TREE_ROW_HEIGHT_PX,
  WorkbenchProjectFileTree,
} from "./workbench-project-file-tree.js";
import {
  collectVisibleProjectFileTreeChangeStats,
  ProjectFileTreeChangeIndicator,
  pruneCollapsedProjectFileTreePaths,
} from "./project-file-tree-changes.js";

describe("WorkbenchProjectFileTree", () => {
  it("removes expanded descendants when their parent is collapsed", () => {
    expect([
      ...pruneCollapsedProjectFileTreePaths(
        new Set(["src", "src/components", "docs"]),
        new Set(["docs"]),
      ),
    ]).toEqual(["docs"]);
  });

  it("renders an accessible virtual tree with the existing compact row height", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WorkbenchProjectFileTree
          client={{
            deleteProjectFile: vi.fn(),
            listProjectFiles: vi.fn(() => Promise.resolve({ entries: [], path: null })),
            renameProjectFile: vi.fn(),
          }}
          expandedPaths={new Set()}
          fileChangesByPath={new Map()}
          onExpandedPathsChange={() => undefined}
          onOpenFileDiff={() => undefined}
          onOpenProjectFile={() => undefined}
          onOpenProjectPath={() => undefined}
          onReferenceProjectPath={() => undefined}
          onRefreshProject={() => undefined}
          projectId="project-1"
          projectName="Codexly"
          projectOpenApps={[]}
          projectOpenPending={false}
          projectPath="/workspace/Codexly"
          projectRootId="root-codexly"
        />
      </QueryClientProvider>,
    );

    expect(PROJECT_FILE_TREE_ROW_HEIGHT_PX).toBe(28);
    expect(markup).toContain('role="tree"');
    expect(markup).toContain('aria-label="项目文件"');
    expect(markup).toContain("cursor-default");
    expect(markup).toContain("Codexly");
  });

  it("places Git line stats on the deepest visible file or directory", () => {
    const visibleEntries = [
      { kind: "entry", name: "src", path: "src", type: "directory" },
      {
        kind: "entry",
        name: "components",
        path: "src/components",
        type: "directory",
      },
      {
        kind: "entry",
        name: "app.tsx",
        path: "src/components/app.tsx",
        type: "file",
      },
    ] as const;
    const changes = new Map([
      [
        "src/components/app.tsx",
        {
          diff: "@@ -1,1 +1,2 @@\n-old\n+new\n+next",
          kind: "update" as const,
          path: "src/components/app.tsx",
        },
      ],
      [
        "src/components/removed.tsx",
        {
          diff: "@@ -1,2 +0,0 @@\n-old\n-content",
          kind: "delete" as const,
          path: "src/components/removed.tsx",
        },
      ],
    ]);

    expect(collectVisibleProjectFileTreeChangeStats(changes, visibleEntries)).toEqual(
      new Map([
        ["src/components/app.tsx", { additions: 2, removals: 1 }],
        ["src/components", { additions: 0, removals: 2 }],
      ]),
    );
  });

  it("renders additions and removals at the end of a changed tree row", () => {
    const markup = renderToStaticMarkup(
      <ProjectFileTreeChangeIndicator path="src/app.tsx" stats={{ additions: 2, removals: 1 }} />,
    );

    expect(markup).toContain('aria-label="src/app.tsx，新增 2 行，删除 1 行"');
    expect(markup).toContain(">+2</span>");
    expect(markup).toContain(">-1</span>");
  });
});
