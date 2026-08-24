import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FileReviewWorkspace,
  getReviewNavigationDirection,
  resolveReviewIndex,
} from "./file-review-dialog.js";
import { ReviewFileTreeNavigation, buildReviewFileTree } from "./file-review-tree.js";
import { TooltipProvider } from "../../shared/components/core/tooltip.js";

describe("file review navigation", () => {
  it("moves between files without crossing review boundaries", () => {
    expect(resolveReviewIndex(0, "previous", 3)).toBe(0);
    expect(resolveReviewIndex(0, "next", 3)).toBe(1);
    expect(resolveReviewIndex(1, "next", 3)).toBe(2);
    expect(resolveReviewIndex(2, "next", 3)).toBe(2);
    expect(resolveReviewIndex(2, "previous", 3)).toBe(1);
    expect(resolveReviewIndex(0, "next", 0)).toBe(0);
  });

  it("reserves horizontal arrow keys for moving through wide diffs", () => {
    expect(getReviewNavigationDirection("ArrowUp")).toBe("previous");
    expect(getReviewNavigationDirection("ArrowDown")).toBe("next");
    expect(getReviewNavigationDirection("ArrowLeft")).toBeNull();
    expect(getReviewNavigationDirection("ArrowRight")).toBeNull();
    expect(getReviewNavigationDirection("Enter")).toBeNull();
  });

  it("builds a compact project-relative tree with per-file statistics", () => {
    const nodes = buildReviewFileTree([
      {
        diff: "@@ -1 +1,2 @@\n-old\n+new\n+next",
        kind: "update",
        path: "apps/web/src/components/main.tsx",
      },
      {
        diff: "+export const dialog = true;",
        kind: "create",
        path: "apps\\web\\src\\dialog.tsx",
      },
      {
        diff: "+export const server = true;",
        kind: "create",
        path: "packages/server/src/index.ts",
      },
      {
        diff: "-legacy",
        kind: "delete",
        path: "README.md",
      },
    ]);

    expect(nodes).toEqual([
      {
        children: [
          {
            children: [
              {
                additions: 2,
                changeIndex: 0,
                name: "main.tsx",
                path: "apps/web/src/components/main.tsx",
                removals: 1,
                type: "file",
              },
            ],
            name: "components",
            path: "apps/web/src/components",
            type: "folder",
          },
          {
            additions: 1,
            changeIndex: 1,
            name: "dialog.tsx",
            path: "apps/web/src/dialog.tsx",
            removals: 0,
            type: "file",
          },
        ],
        name: "apps/web/src",
        path: "apps/web/src",
        type: "folder",
      },
      {
        children: [
          {
            additions: 1,
            changeIndex: 2,
            name: "index.ts",
            path: "packages/server/src/index.ts",
            removals: 0,
            type: "file",
          },
        ],
        name: "packages/server/src",
        path: "packages/server/src",
        type: "folder",
      },
      {
        additions: 0,
        changeIndex: 3,
        name: "README.md",
        path: "README.md",
        removals: 1,
        type: "file",
      },
    ]);
  });

  it("renders the compact tree expanded with the current file selected", () => {
    const nodes = buildReviewFileTree([
      {
        diff: "@@ -1 +1,2 @@\n-old\n+new\n+next",
        kind: "update",
        path: "apps/web/src/main.tsx",
      },
      {
        diff: "+export const test = true;",
        kind: "create",
        path: "apps/web/test/main.test.tsx",
      },
    ]);

    const markup = renderToStaticMarkup(
      <ReviewFileTreeNavigation
        nodes={nodes}
        onSelect={() => undefined}
        selectedPath="apps/web/src/main.tsx"
      />,
    );

    expect(markup).toContain('role="tree"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("apps/web");
    expect(markup).toContain("src");
    expect(markup).toContain("main.tsx");
    expect(markup).toContain("+2");
    expect(markup).toContain("-1");
  });

  it("renders a reusable review workspace without a dialog shell", () => {
    const changes = [
      { diff: "", kind: "update" as const, path: "src/index.ts" },
      { diff: "", kind: "create" as const, path: "src/new.ts" },
    ];
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <FileReviewWorkspace
          changes={changes}
          currentIndex={0}
          onClose={() => undefined}
          onCurrentIndexChange={() => undefined}
          renderContent={(change) => <p>{`按需读取 ${change.path}`}</p>}
          showStats={false}
          titleId="embedded-review-title"
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('id="embedded-review-title"');
    expect(markup).toContain("按需读取 src/index.ts");
    expect(markup).toContain("src/index.ts");
    expect(markup).not.toContain('data-slot="dialog-content"');
    expect(markup).not.toContain("+0");
  });
});
