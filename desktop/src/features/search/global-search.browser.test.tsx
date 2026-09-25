import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { I18nextProvider, i18n } from "../../i18n/i18n.js";
import { TooltipProvider } from "../../shared/components/core/tooltip.js";
import type { NativeWorkbenchClient } from "../projects/project-query-contracts.js";
import { GlobalSearchDialog } from "./global-search-dialog.js";
import { useHistoryLocation } from "./history-location.js";
import "../../shared/styles/globals.css";
import "../../shared/styles/workbench.css";

const { navigate } = vi.hoisted(() => ({
  navigate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
const task = {
  id: "t",
  projectId: "p",
  title: "修复搜索",
  pinned: false,
  updatedAt: "2026-09-15T00:00:00Z",
};
const occurrence = {
  itemId: "message-42",
  turnId: "turn-42",
  turnCursor: "inclusive-42",
  snippet: "历史搜索命中",
  snippetMatchRange: { start: 2, end: 4 },
};
const projects = [
  {
    id: "p",
    name: "CodeAgent",
    createdAt: "2026-09-15T00:00:00Z",
    roots: [{ id: "r", path: "/project" }],
  },
];
function createClient() {
  return {
    searchTasks: vi
      .fn()
      .mockImplementation(async (input) => ({
        data: [
          { task, snippet: input.kind === "history" ? "历史搜索命中" : "", ...(input.kind === "history" ? { occurrence } : {}) },
        ],
        nextCursor: null,
      })),
    searchTaskOccurrences: vi
      .fn()
      .mockResolvedValue({ data: [occurrence], nextCursor: null }),
    searchProjectFiles: vi
      .fn()
      .mockResolvedValue({
        data: [
          {
            rootId: "r",
            rootPath: "/project",
            name: "search.ts",
            path: "src/search.ts",
          },
        ],
      }),
    openProject: vi.fn().mockResolvedValue({}),
  };
}
async function setup(client = createClient()) {
  await i18n.changeLanguage("zh-CN");
  const onClose = vi.fn();
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function SearchHarness() {
    const [open, setOpen] = useState(true);
    return <>
      <button onClick={() => setOpen(true)}>重新打开搜索</button>
      <GlobalSearchDialog open={open} client={client as unknown as NativeWorkbenchClient} projects={projects} onClose={() => { onClose(); setOpen(false); }} />
    </>;
  }
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={cache}>
        <TooltipProvider>
          <SearchHarness />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { screen, client, onClose, cache };
}
beforeEach(() => {
  navigate.mockClear();
  useHistoryLocation.getState().setLocation(null);
});

describe("global search dialog", () => {
  it("preserves results and filters after closing and selects the query on reopen", async () => {
    const { screen, client } = await setup();
    await screen.getByRole("combobox").fill("搜索");
    await screen.getByRole("button", { name: "历史记录", exact: true }).click();
    await expect.element(screen.getByRole("option", { name: /历史搜索命中/ })).toBeVisible();
    const calls = client.searchTasks.mock.calls.length;
    await screen.getByRole("button", { name: "关闭搜索" }).click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "重新打开搜索" }).click();
    const input = screen.getByRole("combobox").element() as HTMLInputElement;
    expect(input.value).toBe("搜索");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);
    await expect.element(screen.getByRole("option", { name: /历史搜索命中/ })).toBeVisible();
    expect(client.searchTasks.mock.calls.length).toBe(calls);
    await userEvent.keyboard("新");
    expect(input.value).toBe("新");
  });

  it("restores the same occurrence page without repeating its request", async () => {
    const client = createClient();
    client.searchTaskOccurrences.mockImplementation(async (_taskId, _query, cursor) => ({
      data: [{ ...occurrence, snippet: cursor ? "第二页搜索命中" : "第一页搜索命中" }],
      nextCursor: cursor ? null : "page-2",
    }));
    const { screen } = await setup(client);
    await screen.getByRole("combobox").fill("搜索");
    await screen.getByRole("button", { name: "历史记录", exact: true }).click();
    await screen.getByRole("button", { name: "消息中的匹配位置" }).click();
    await screen.getByRole("button", { name: "下一页" }).click();
    await expect.element(screen.getByRole("button", { name: "第二页搜索命中" })).toBeVisible();
    await screen.getByRole("button", { name: "关闭搜索" }).click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "重新打开搜索" }).click();
    await expect.element(screen.getByRole("button", { name: "第二页搜索命中" })).toBeVisible();
    expect(client.searchTaskOccurrences).toHaveBeenCalledTimes(2);
  });

  it("cancels an in-flight search when closed", async () => {
    const client = createClient();
    let signal: AbortSignal | undefined;
    client.searchTasks.mockImplementation(async (_input, options) => {
      signal = options.signal;
      return new Promise(() => undefined);
    });
    const { screen } = await setup(client);
    await screen.getByRole("combobox").fill("搜索");
    await vi.waitFor(() => expect(signal).toBeDefined());
    await screen.getByRole("button", { name: "关闭搜索" }).click();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it("aggregates sources on demand and opens the selected task with Enter", async () => {
    const { screen, client, onClose } = await setup();
    expect(client.searchTasks).not.toHaveBeenCalled();
    const input = screen.getByRole("combobox", { name: "全局搜索" });
    expect(document.activeElement).toBe(input.element());
    expect(getComputedStyle(input.element()).outlineStyle).toBe("none");
    expect(parseFloat(getComputedStyle(input.element()).borderRadius)).toBeGreaterThan(0);
    await input.fill("搜索");
    await expect
      .element(screen.getByRole("group", { name: "任务", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("group", { name: "历史记录" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("group", { name: "项目文件" }))
      .toBeVisible();
    await page.screenshot({ path: "../../../test-results/global-search.png" });
    document.documentElement.dataset["theme"] = "dark";
    try {
      await vi.waitFor(() => expect(getComputedStyle(screen.getByRole("dialog").element()).backgroundColor).toBe("rgb(32, 32, 32)"));
      await page.screenshot({ path: "../../../test-results/global-search-dark.png" });
    } finally {
      delete document.documentElement.dataset["theme"];
    }
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/p/$projectId/t/$taskId",
        params: { projectId: "p", taskId: "t" },
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("opens a history result at its exact occurrence without loading whole task histories", async () => {
    const { screen, client, onClose } = await setup();
    await screen.getByRole("combobox").fill("搜索");
    await screen.getByRole("option", { name: /历史搜索命中/ }).click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.searchTaskOccurrences).not.toHaveBeenCalled();
    expect(useHistoryLocation.getState().location).toEqual({
      ...occurrence,
      projectId: "p",
      taskId: "t",
      query: "搜索",
    });
  });

  it("keeps successful sources visible when history search fails", async () => {
    const client = createClient();
    client.searchTasks.mockImplementation(async (input) => {
      if (input.kind === "history") throw new Error("unavailable");
      return { data: [{ task, snippet: "" }], nextCursor: null };
    });
    const { screen } = await setup(client);
    await screen.getByRole("combobox").fill("搜索");
    await expect
      .element(screen.getByRole("group", { name: "任务", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("group", { name: "项目文件" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("搜索失败");
  });
  it("cancels obsolete queries and never replaces fresh results with late responses", async () => {
    const client = createClient();
    let releaseOld: (() => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    client.searchTasks.mockImplementation(async (input, options) => {
      if (input.query === "旧" && input.kind === "tasks") {
        oldSignal = options.signal;
        await new Promise<void>((resolve) => { releaseOld = resolve; });
      }
      return { data: [{ task: { ...task, title: `${input.query}任务` }, snippet: "" }], nextCursor: null };
    });
    const { screen } = await setup(client);
    await screen.getByRole("combobox").fill("旧");
    await vi.waitFor(() => expect(releaseOld).toBeDefined());
    await screen.getByRole("combobox").fill("新");
    await vi.waitFor(() => expect(oldSignal?.aborted).toBe(true));
    releaseOld!();
    await expect.element(screen.getByRole("option", { name: "新任务 CodeAgent", exact: true }).first()).toBeVisible();
    expect(screen.getByRole("option", { name: "旧任务 CodeAgent", exact: true }).query()).toBeNull();
  });

});
