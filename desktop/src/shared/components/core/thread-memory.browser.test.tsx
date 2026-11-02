import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThreadMemorySection, threadMemoryLabels, type ThreadMemoryClient } from "@codexly/ui/core/thread-memory-section";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import "../../styles/globals.css";

function view(client: ThreadMemoryClient, cache: QueryClient, taskId = "task") {
  return <QueryClientProvider client={cache}><TooltipProvider><ThreadMemorySection client={client} projectId="project" taskId={taskId} revision="idle" labels={threadMemoryLabels.zh} /></TooltipProvider></QueryClientProvider>;
}

it.each([
  { status: "ready", summary: null },
  { status: "ready", summary: "  \n " },
  { status: "not_loaded", summary: null },
  { status: "unsupported", summary: null },
] as const)("无摘要时整个模块隐藏：%j", async (response) => {
  const read = vi.fn().mockResolvedValue(response);
  const screen = await render(view({ readThreadMemory: read }, new QueryClient()));
  await expect.poll(() => read.mock.settledResults.length).toBe(1);
  await expect.element(screen.getByRole("region", { name: threadMemoryLabels.zh.title })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: threadMemoryLabels.zh.refresh })).not.toBeInTheDocument();
});

it("首载和无内容的读取失败不显示模块", async () => {
  const read = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => {
    rejectRead = reject;
  }));
  let rejectRead: (error: Error) => void = () => undefined;
  const screen = await render(view({ readThreadMemory: read }, new QueryClient()));
  await expect.element(screen.getByRole("region", { name: threadMemoryLabels.zh.title })).not.toBeInTheDocument();
  rejectRead(new Error("offline"));
  await expect.poll(() => read.mock.settledResults.length).toBe(1);
  await expect.element(screen.getByRole("region", { name: threadMemoryLabels.zh.title })).not.toBeInTheDocument();
});

it("仅展示摘要与 MCP 同规格图标刷新，空结果隐藏，切换会话不残留", async () => {
  await page.viewport(320, 720);
  const read = vi.fn()
    .mockResolvedValueOnce({ status: "ready", summary: "# Memory\n<script>bad()</script>\n" + "a".repeat(500) })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ status: "ready", summary: null })
    .mockResolvedValueOnce({ status: "not_loaded", summary: null });
  const cache = new QueryClient();
  const client = { readThreadMemory: read };
  const screen = await render(view(client, cache));
  const region = screen.getByRole("region", { name: threadMemoryLabels.zh.title });
  await expect.element(screen.getByText(/<script>bad/)).toBeVisible();
  const refresh = screen.getByRole("button", { name: threadMemoryLabels.zh.refresh });
  expect(refresh.element().textContent).toBe("");
  expect(refresh.element().querySelector("svg")).not.toBeNull();
  expect(refresh.element().getBoundingClientRect().width).toBe(28);
  expect(region.element().textContent).not.toContain("实验");
  expect(document.querySelector("section script")).toBeNull();
  const content = document.querySelector("section pre")!;
  expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
  await refresh.click();
  await expect.poll(() => read.mock.settledResults.length).toBe(2);
  await expect.element(screen.getByText(/<script>bad/)).toBeVisible();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await refresh.click();
  await expect.element(region).not.toBeInTheDocument();
  await screen.rerender(view(client, cache, "other"));
  await expect.poll(() => read.mock.settledResults.length).toBe(4);
  await expect.element(region).not.toBeInTheDocument();
  await screen.unmount();
  expect(cache.getQueryCache().getAll()).toHaveLength(0);
});
