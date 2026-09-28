import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tabs } from "radix-ui";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { NativeWorkbenchClient } from "../../projects/project-queries.js";
import { WorkbenchInspector, type WorkbenchInspectorTab } from "./workbench-inspector.js";
import { documentTabId, type InspectorDocument } from "./workbench-inspector-documents.js";
import { WorkbenchInspectorTabs } from "./workbench-inspector-tabs.js";

vi.mock("../../diff/patch-diff-viewer.js", () => ({
  default: ({ change }: Readonly<{ change: AgentFileChange }>) => <pre>{change.diff}</pre>,
}));

const change = {
  diff: "@@ -1 +1 @@\n-old\n+new",
  kind: "update",
  path: "src/main.ts",
  stats: { additions: 1, removals: 1 },
} as const satisfies AgentFileChange;
const sourceId = "source:src/main.ts";
const diffId = "diff:src/main.ts";

function visibleWidth(container: Element, element: Element) {
  const viewport = container.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  return Math.max(0, Math.min(bounds.right, viewport.right) - Math.max(bounds.left, viewport.left));
}

it("标签溢出时隐藏滚动条，并在点击后露出左右相邻标签", async () => {
  await i18n.changeLanguage("zh-CN");
  const documents: InspectorDocument[] = Array.from({ length: 18 }, (_, index) => {
    const path = `src/file-${index}.ts`;
    return {
      id: `source:${path}`,
      kind: "source",
      change: { ...change, path },
      reference: { lineNumber: null, path },
    };
  });

  function Harness() {
    const [tab, setTab] = useState<WorkbenchInspectorTab>("project");
    return (
      <TooltipProvider>
        <div style={{ display: "flex", width: 280 }}>
          <Tabs.Root
            onValueChange={(value) => setTab(value as WorkbenchInspectorTab)}
            style={{ minWidth: 0, width: "100%" }}
            value={tab}
          >
            <WorkbenchInspectorTabs
              activeTab={tab}
              availableTabs={["project", ...documents.map((document) => documentTabId(document.id))]}
              documents={documents}
              onTabChange={setTab}
            />
          </Tabs.Root>
        </div>
      </TooltipProvider>
    );
  }

  const screen = await render(<Harness />);
  const tabList = screen.getByRole("tablist").element();
  expect(tabList.scrollWidth).toBeGreaterThan(tabList.clientWidth);
  expect(getComputedStyle(tabList).scrollbarWidth).toBe("none");
  tabList.scrollLeft = tabList.scrollWidth;
  expect(tabList.scrollLeft).toBeGreaterThan(0);
  await screen.getByRole("tab", { name: "file-17.ts" }).click();
  await expect
    .element(screen.getByRole("tab", { name: "file-17.ts" }))
    .toHaveAttribute("aria-selected", "true");

  await screen.getByRole("tab", { name: "file-5.ts" }).click();
  const rightPrevious = screen.getByRole("tab", { name: "file-5.ts" }).element().parentElement!;
  const rightNeighbor = screen.getByRole("tab", { name: "file-7.ts" }).element().parentElement!;
  const rightActive = screen.getByRole("tab", { name: "file-6.ts" }).element().parentElement!;
  tabList.scrollLeft +=
    rightActive.getBoundingClientRect().right - tabList.getBoundingClientRect().right;
  expect(visibleWidth(tabList, rightNeighbor)).toBe(0);
  await screen.getByRole("tab", { name: "file-6.ts" }).click();
  expect(visibleWidth(tabList, rightPrevious)).toBeGreaterThanOrEqual(20);
  expect(visibleWidth(tabList, rightNeighbor)).toBeGreaterThanOrEqual(20);

  await screen.getByRole("tab", { name: "file-10.ts" }).click();
  const leftNeighbor = screen.getByRole("tab", { name: "file-8.ts" }).element().parentElement!;
  const leftActive = screen.getByRole("tab", { name: "file-9.ts" }).element().parentElement!;
  const leftNext = screen.getByRole("tab", { name: "file-10.ts" }).element().parentElement!;
  tabList.scrollLeft +=
    leftActive.getBoundingClientRect().left - tabList.getBoundingClientRect().left;
  expect(visibleWidth(tabList, leftNeighbor)).toBe(0);
  await screen.getByRole("tab", { name: "file-9.ts" }).click();
  expect(visibleWidth(tabList, leftNeighbor)).toBeGreaterThanOrEqual(20);
  expect(visibleWidth(tabList, leftNext)).toBeGreaterThanOrEqual(20);
});

it("文件预览从独立标签打开 Diff，关闭 Diff 后保留原文件", async () => {
  await i18n.changeLanguage("zh-CN");
  const loadDiff = vi.fn().mockResolvedValue(change);
  const client = {
    readProjectSourceFile: vi.fn().mockResolvedValue({
      content: "const value = 'new';\n",
      nextCursor: null,
      path: change.path,
    }),
    listProjectFiles: vi.fn().mockResolvedValue({ entries: [], path: null }),
  } as unknown as NativeWorkbenchClient;
  const queryClient = new QueryClient();

  function Harness() {
    const [tab, setTab] = useState<WorkbenchInspectorTab>(documentTabId(sourceId));
    const [documents, setDocuments] = useState<InspectorDocument[]>([
      { id: sourceId, kind: "source", change, reference: { lineNumber: null, path: change.path } },
    ]);
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div style={{ height: 640, width: 360, display: "flex" }}>
            <WorkbenchInspector
              documents={documents}
              gitClient={client}
              loadProjectFileDiff={loadDiff}
              onCloseDocument={(id) => {
                setDocuments((current) => current.filter((document) => document.id !== id));
                setTab(documentTabId(sourceId));
              }}
              onOpenLoadedDiff={(loadedChange) => {
                setDocuments((current) => [
                  ...current,
                  { id: diffId, kind: "diff", change: loadedChange },
                ]);
                setTab(documentTabId(diffId));
              }}
              onTabChange={setTab}
              projectId="project-a"
              projectName="Project A"
              projectPath="/workspace/project-a"
              projectRootId="root-a"
              sourceRootPath="/workspace/project-a"
              tab={tab}
            />
          </div>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "查看 Diff" }).click();
  expect(loadDiff).toHaveBeenCalledExactlyOnceWith(change);
  await expect
    .element(screen.getByRole("tab", { name: "Diff: main.ts" }))
    .toHaveAttribute("aria-selected", "true");
  await expect.element(screen.getByRole("tab", { name: "main.ts", exact: true })).toBeVisible();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await screen
    .getByRole("group", { name: "文件" })
    .last()
    .getByRole("button", { name: "关闭文件" })
    .click();
  await expect
    .element(screen.getByRole("tab", { name: "main.ts", exact: true }))
    .toHaveAttribute("aria-selected", "true");
});
