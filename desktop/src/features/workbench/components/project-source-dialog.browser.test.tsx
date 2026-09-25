import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { NativeSourceFileClient } from "../../projects/project-query-contracts.js";
import { ProjectSourceDialog } from "./project-source-dialog.js";

vi.mock("../../diff/patch-diff-viewer.js", () => ({
  default: ({ change }: Readonly<{ change: AgentFileChange }>) => (
    <pre data-testid="project-file-diff">{change.diff}</pre>
  ),
}));

const change = {
  diff: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new\n",
  kind: "update",
  path: "src/main.ts",
  stats: { additions: 1, removals: 1 },
} as const satisfies AgentFileChange;

function createClient(): NativeSourceFileClient {
  return {
    cacheProjectImage: vi.fn(),
    readProjectSourceFile: vi.fn().mockResolvedValue({
      content: "const value = 'new';\n",
      nextCursor: null,
      path: change.path,
    }),
  };
}

describe("ProjectSourceDialog", () => {
  it("先预览修改后的文件，并允许在同一弹窗切换 Diff", async () => {
    await i18n.changeLanguage("zh-CN");
    const loadDiff = vi.fn().mockResolvedValue(change);
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nextProvider i18n={i18n}>
          <TooltipProvider>
            <ProjectSourceDialog
              change={change}
              client={createClient()}
              loadDiff={loadDiff}
              onClose={vi.fn()}
              previewKind="source"
              projectId="project-a"
              reference={{ lineNumber: null, path: change.path }}
              rootPath="/workspace/project-a"
            />
          </TooltipProvider>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    const showDiff = screen.getByRole("button", { name: "查看 Diff" });
    await expect.element(showDiff).toBeVisible();
    expect(screen.getByTestId("project-file-diff").query()).toBeNull();

    await showDiff.click();

    expect(loadDiff).toHaveBeenCalledExactlyOnceWith(change);
    await expect.element(screen.getByTestId("project-file-diff")).toBeVisible();
    await screen.getByRole("button", { name: "查看文件内容" }).click();
    await expect.element(screen.getByRole("button", { name: "查看 Diff" })).toBeVisible();
  });
});
