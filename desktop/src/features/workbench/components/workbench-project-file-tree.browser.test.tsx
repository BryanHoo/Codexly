import "../../../shared/styles/globals.css";
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
    createProjectFile: vi.fn(),
    deleteProjectFile: vi.fn(),
    listProjectFiles: vi.fn().mockResolvedValue({
      entries: [{ path: change.path, type: "file" }],
      path: null,
    }),
    renameProjectFile: vi.fn(),
  };
}


function renderTree(client: NativeFileTreeClient, onOpenProjectFile: (path: string, change?: AgentFileChange) => void) {
  return render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nextProvider i18n={i18n}>
          <TooltipProvider>
            <div style={{ height: 400, width: 320 }}>
              <WorkbenchProjectFileTree
                client={client}
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
}

describe("WorkbenchProjectFileTree", () => {
  it("打开修改文件时进入文件预览并携带 Diff 信息", async () => {
    await i18n.changeLanguage("zh-CN");
    const onOpenProjectFile = vi.fn();
    const screen = await renderTree(createClient(), onOpenProjectFile);

    const file = screen.getByRole("treeitem", { name: /main\.ts/u });
    await expect.element(file).toBeVisible();
    await file.click();
    expect(onOpenProjectFile).toHaveBeenCalledExactlyOnceWith(change.path, change);
    onOpenProjectFile.mockClear();
    await userEvent.keyboard("{Enter}");

    expect(onOpenProjectFile).toHaveBeenCalledExactlyOnceWith(change.path, change);
  });
  it("一万文件使用 End 跳转后聚焦挂载目标并保持虚拟行数量有界", async () => {
    const client = createClient();
    vi.mocked(client.listProjectFiles).mockResolvedValue({
      entries: Array.from({length:10_000}, (_,index) => ({path:`file-${String(index).padStart(5,"0")}.ts`,type:"file" as const})),
      path:null,
    });
    const screen = await renderTree(client, vi.fn());
    const root = screen.getByRole("treeitem", {name:"Project A",exact:true});
    await expect.element(screen.getByRole("treeitem", {name:"file-00000.ts",exact:true})).toBeVisible();
    root.element().focus();
    await userEvent.keyboard("{End}");
    await expect.element(screen.getByRole("treeitem", {name:"file-09999.ts",exact:true})).toHaveFocus();
    expect(screen.container.querySelectorAll('[role="treeitem"]').length).toBeLessThanOrEqual(40);
  });

});
