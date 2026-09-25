import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { TooltipProvider } from "../../shared/components/core/tooltip.js";
import { AsyncFileDiff } from "./async-file-diff.js";
import type { AgentFileChange } from "./file-change.js";
import "../../shared/styles/globals.css";

it("审核切换时只显示当前文件，忽略迟到的旧补丁", async () => {
  const first: AgentFileChange = { path: "first.txt", kind: "update", diff: "", stats: { additions: 0, removals: 0 } };
  const second = { ...first, path: "second.txt" };
  let resolveFirst!: (value: AgentFileChange) => void;
  const pending = new Promise<AgentFileChange>((resolve) => { resolveFirst = resolve; });
  const loadDiff = vi.fn((change: AgentFileChange) => change === first ? pending : Promise.resolve({ ...second, diff: "diff --git a/second.txt b/second.txt\n--- a/second.txt\n+++ b/second.txt\n@@ -1 +1 @@\n-old\n+new\n" }));
  const screen = await render(<TooltipProvider><AsyncFileDiff change={first} loadDiff={loadDiff} /></TooltipProvider>);
  await screen.rerender(<TooltipProvider><AsyncFileDiff change={second} loadDiff={loadDiff} /></TooltipProvider>);
  await expect.element(screen.getByRole("region", { name: "second.txt", exact: true })).toBeVisible();
  resolveFirst(first);
  await expect.element(screen.getByRole("region", { name: "first.txt", exact: true })).not.toBeInTheDocument();
  expect(loadDiff.mock.calls.map(([change]) => change.path)).toEqual(["first.txt", "second.txt"]);
});
