import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectDirectoryListing } from "@code-agent/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import {
  ProjectDirectoryPickerDialog,
  ProjectDirectoryTree,
  type ProjectDirectoryState,
} from "./project-directory-picker-dialog.js";

describe("ProjectDirectoryPickerDialog", () => {
  it("renders an accessible loading dialog while resolving the host home directory", async () => {
    await changeAppLanguage("zh-CN");
    const queryClient = new QueryClient();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ProjectDirectoryPickerDialog
            client={{
              listProjectDirectories: vi.fn(
                (): Promise<ProjectDirectoryListing> => new Promise(() => undefined),
              ),
            }}
            isAdding={false}
            onAdd={vi.fn()}
            onClose={vi.fn()}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("选择项目文件夹");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("正在读取文件夹");
    expect(markup).toContain('aria-label="绝对目录路径"');
    expect(markup).toContain('aria-label="前往此路径"');
    expect(markup).toContain('aria-label="显示隐藏文件夹"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it("renders lazy directory children and a retry action for a failed branch", () => {
    const states: readonly ProjectDirectoryState[] = [
      {
        data: {
          entries: [{ name: "src", path: "/workspace/CodeAgent/packages/src" }],
          parentPath: "/workspace/CodeAgent",
          path: "/workspace/CodeAgent/packages",
          roots: [],
        },
        error: null,
        isFetching: false,
        path: "/workspace/CodeAgent/packages",
      },
      {
        error: new Error("permission denied"),
        isFetching: false,
        path: "/workspace/CodeAgent/examples",
      },
    ];
    const markup = renderToStaticMarkup(
      <ProjectDirectoryTree
        directoryStates={states}
        expandedPaths={new Set(["/workspace/CodeAgent/packages", "/workspace/CodeAgent/examples"])}
        listing={{
          entries: [
            { name: "examples", path: "/workspace/CodeAgent/examples" },
            { name: "packages", path: "/workspace/CodeAgent/packages" },
          ],
          parentPath: "/workspace",
          path: "/workspace/CodeAgent",
          roots: [],
        }}
        onExpandedChange={vi.fn()}
        onRetry={vi.fn()}
        onRootCheckedChange={vi.fn()}
        selectedPaths={new Set(["/workspace/CodeAgent/packages"])}
      />,
    );

    expect(markup).toContain('role="tree"');
    expect(markup).toContain("packages");
    expect(markup).toContain("src");
    expect(markup).toContain('aria-label="选择 packages"');
    expect(markup).toContain('data-state="checked"');
    expect(markup).toContain("无法读取此文件夹");
    expect(markup).toContain("重试");
  });

  it("renders a drive selector when multiple Windows filesystem roots are available", async () => {
    await changeAppLanguage("zh-CN");
    const queryClient = new QueryClient();
    queryClient.setQueryData<ProjectDirectoryListing>(["project-directories", null, false], {
      entries: [],
      parentPath: null,
      path: "D:\\",
      roots: [
        { name: "C:", path: "C:\\" },
        { name: "D:", path: "D:\\" },
      ],
    });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ProjectDirectoryPickerDialog
            client={{ listProjectDirectories: vi.fn() }}
            isAdding={false}
            onAdd={vi.fn()}
            onClose={vi.fn()}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain('aria-label="选择磁盘"');
    expect(markup).toContain("D:");
  });
});
