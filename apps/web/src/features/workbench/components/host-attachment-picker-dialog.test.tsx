import type { HostFileListing } from "@code-agent/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import {
  HostAttachmentPickerDialog,
  HostFileTree,
  type HostFileDirectoryState,
} from "./host-attachment-picker-dialog.js";

describe("HostAttachmentPickerDialog", () => {
  it("renders an accessible loading dialog for the CodeAgent host", async () => {
    await changeAppLanguage("zh-CN");
    const queryClient = new QueryClient();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <HostAttachmentPickerDialog
            client={{
              importHostAttachment: vi.fn(),
              listHostFiles: vi.fn((): Promise<HostFileListing> => new Promise(() => undefined)),
            }}
            kind="image"
            onAdd={vi.fn()}
            onClose={vi.fn()}
            projectId="code-agent"
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("选择本机图片");
    expect(markup).toContain("正在读取文件");
    expect(markup).toContain('aria-label="绝对目录路径"');
    expect(markup).toContain('aria-label="前往此路径"');
    expect(markup).toContain('aria-label="显示隐藏文件"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it("renders supported files, lazy directory children, and failed-branch retry state", () => {
    const states: readonly HostFileDirectoryState[] = [
      {
        data: {
          entries: [
            { name: "nested.png", path: "/Users/bryan/Pictures/design/nested.png", type: "file" },
          ],
          parentPath: "/Users/bryan/Pictures",
          path: "/Users/bryan/Pictures/design",
          roots: [],
        },
        error: null,
        isFetching: false,
        path: "/Users/bryan/Pictures/design",
      },
      {
        error: new Error("permission denied"),
        isFetching: false,
        path: "/Users/bryan/Pictures/private",
      },
    ];
    const markup = renderToStaticMarkup(
      <HostFileTree
        directoryStates={states}
        expandedPaths={new Set(["/Users/bryan/Pictures/design", "/Users/bryan/Pictures/private"])}
        listing={{
          entries: [
            { name: "design", path: "/Users/bryan/Pictures/design", type: "directory" },
            { name: "private", path: "/Users/bryan/Pictures/private", type: "directory" },
            { name: "screen.png", path: "/Users/bryan/Pictures/screen.png", type: "file" },
          ],
          parentPath: "/Users/bryan",
          path: "/Users/bryan/Pictures",
          roots: [],
        }}
        onExpandedChange={vi.fn()}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
        selectedPath="/Users/bryan/Pictures/screen.png"
      />,
    );

    expect(markup).toContain('role="tree"');
    expect(markup).toContain("screen.png");
    expect(markup).toContain("nested.png");
    expect(markup).toContain("无法读取此文件夹");
    expect(markup).toContain("重试");
  });

  it("renders a drive selector when multiple Windows filesystem roots are available", async () => {
    await changeAppLanguage("zh-CN");
    const queryClient = new QueryClient();
    queryClient.setQueryData<HostFileListing>(["host-files", "image", null, false], {
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
          <HostAttachmentPickerDialog
            client={{ importHostAttachment: vi.fn(), listHostFiles: vi.fn() }}
            kind="image"
            onAdd={vi.fn()}
            onClose={vi.fn()}
            projectId="code-agent"
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain('aria-label="选择磁盘"');
    expect(markup).toContain("D:");
  });
});
