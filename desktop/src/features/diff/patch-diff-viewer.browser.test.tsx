import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import LegacyPatchDiffViewer from "../../compat/macos-legacy/patch-diff-viewer.js";
import PatchDiffViewer from "./patch-diff-viewer.js";

vi.mock("@pierre/diffs", () => ({
  getFiletypeFromFileName: () => "text",
  preloadHighlighter: async () => undefined,
  setCustomExtension: () => undefined,
}));
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({ patch }: { patch: string }) => <pre data-testid="native-patch">{patch}</pre>,
}));

it("Modern 原样传递原生补丁，保留尾部空格和换行", async () => {
  const diff = "--- /dev/null\n+++ b/sample.txt\n@@ -0,0 +1,1 @@\n+last  \n";
  await render(<PatchDiffViewer change={{ path: "sample.txt", kind: "create", diff, stats: { additions: 1, removals: 0 } }} />);
  await expect.poll(() => document.querySelector('[data-testid="native-patch"]')?.textContent).toBe(diff);
});

it("Legacy 直接渲染原生新增补丁，不把补丁头再次变成新增正文", async () => {
  await render(<LegacyPatchDiffViewer change={{
    path: "sample.txt", kind: "create", stats: { additions: 2, removals: 0 },
    diff: "--- /dev/null\n+++ b/sample.txt\n@@ -0,0 +1,2 @@\n+first\n+last  \n",
  }} />);
  await expect.poll(() => document.querySelectorAll('.legacy-diff-line[data-kind="+"]').length).toBe(2);
  expect(document.querySelector('.legacy-diff-line[data-kind="+"]')?.textContent).toContain("first");
});
