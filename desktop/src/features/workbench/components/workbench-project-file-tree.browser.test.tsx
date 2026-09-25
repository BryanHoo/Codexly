import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { NativeFileTreeClient } from "../../projects/project-query-contracts.js";
import { WorkbenchProjectFileTree } from "./workbench-project-file-tree.js";

const change = {
  diff: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new\n",
  kind: "update",
  path: "src/main.ts",
  stats: { additions: 1, removals: 1 },
} as const satisfies AgentFileChange;

function createClient(): NativeFileTreeClient {
  return {
    deleteProjectFile: vi.fn(),
    listProjectFiles: vi.fn().mockResolvedValue({
      entries: [{ path: change.path, type: "file" }],
      path: null,
    }),
    renameProjectFile: vi.fn(),
  };
}

describe("WorkbenchProjectFileTree", () => {
  it("打开修改文件时进入文件预览并携带 Diff 信息", async () => {
    await i18n.changeLanguage("zh-CN");
    const onOpenProjectFile = vi.fn();
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nextProvider i18n={i18n}>
          <TooltipProvider>
            <div className="h-[400px] w-[320px]">
              <WorkbenchProjectFileTree
                client={createClient()}
                expandedPaths={new Set()}
                fileChangesByPath={new Map([[change.path, change]])}
                onExpandedPathsChange={vi.fn()}
                onOpenProjectFile={onOpenProjectFile}
                onOpenProjectPath={vi.fn()}
                onReferenceProjectPath={vi.fn()}
                onRefreshProject={vi.fn()}
                projectId="project-a"
                projectName="Project A"
                projectOpenApps={[]}
                projectOpenPending={false}
                projectPath="/workspace/project-a"
                projectRootId="root-a"
              />
            </div>
          </TooltipProvider>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    const file = screen.getByRole("treeitem", { name: /main\.ts/u });
    await expect.element(file).toBeVisible();
    await file.click();
    await userEvent.keyboard("{Enter}");

    expect(onOpenProjectFile).toHaveBeenCalledExactlyOnceWith(change.path, change);
  });
});
