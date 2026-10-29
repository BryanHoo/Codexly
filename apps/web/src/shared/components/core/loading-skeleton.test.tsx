import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingSkeleton } from "@codexly/ui/core/loading-skeleton";
import { Skeleton } from "@codexly/ui/core/skeleton";
import { ArchivedTaskListView } from "../../../features/workbench/components/archived-tasks-dialog.js";
import { WorkbenchInspectorChanges } from "../../../features/workbench/components/workbench-inspector-changes.js";

describe("共享加载骨架", () => {
  it.each([
    "list",
    "conversation",
    "settings",
    "cards",
    "statistics",
    "workspace",
    "code",
  ] as const)("%s 只播报一次加载状态，不暴露占位图形或可聚焦控件", (variant) => {
    const html = renderToStaticMarkup(<LoadingSkeleton label="正在加载…" variant={variant} />);
    expect(html.match(/role="status"/gu)).toHaveLength(1);
    expect(html.match(/正在加载…/gu)).toHaveLength(1);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toMatch(/<(button|input|a)\b/u);
  });

  it("允许调用方覆盖形状并遵循减少动态效果设置", () => {
    const html = renderToStaticMarkup(<Skeleton className="h-4 w-24 rounded-full" />);
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).toContain("rounded-full");
    expect(html).not.toContain("rounded-md");
  });

  it("归档首载呈现列表轮廓，读取失败时保留重试入口", () => {
    const props = {
      error: null,
      isPending: true,
      mutationPending: false,
      onDelete: () => undefined,
      onDeleteAll: () => undefined,
      onNext: () => undefined,
      onPrevious: () => undefined,
      onRestore: () => undefined,
      page: undefined,
      pageNumber: 1,
    };
    const loading = renderToStaticMarkup(<ArchivedTaskListView {...props} />);
    expect(loading).toContain('data-slot="loading-skeleton"');
    expect(loading).toContain('data-variant="list"');
    const failed = renderToStaticMarkup(
      <ArchivedTaskListView {...props} isPending={false} error={new Error("读取失败")} />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("重试");
    expect(failed).not.toContain('data-slot="loading-skeleton"');
  });

  it("Git 详情首载显示骨架，失败后完整显示错误", () => {
    const props = {
      client: undefined,
      detailsError: null,
      detailsPending: true,
      detailsStatus: undefined,
      gitStatus: undefined,
      gitStatusError: null,
      onOpenFileDiff: () => undefined,
      projectId: "project",
      rootPath: "/repo",
    };
    expect(renderToStaticMarkup(<WorkbenchInspectorChanges {...props} />)).toContain(
      'data-slot="loading-skeleton"',
    );
    const failed = renderToStaticMarkup(
      <WorkbenchInspectorChanges {...props} gitStatusError={new Error("Git 不可用")} />,
    );
    expect(failed).toContain("Git 不可用");
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('data-slot="loading-skeleton"');
  });
});
