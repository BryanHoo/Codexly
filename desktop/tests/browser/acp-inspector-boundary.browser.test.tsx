import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { WorkbenchInspector as WebInspector } from "../../../apps/web/src/features/workbench/components/workbench-inspector.js";
import { WorkbenchInspector as NativeInspector } from "../../src/features/workbench/components/workbench-inspector.js";
import { mcpServersQueryOptions as webQuery, mcpServersReloadMutationOptions as webReload } from "../../../apps/web/src/features/projects/project-query-options.js";
import { mcpServersQueryOptions as nativeQuery, mcpServersReloadMutationOptions as nativeReload } from "../../src/features/projects/project-query-options.js";
import "../../src/shared/styles/globals.css";

for (const [platform, Inspector, query, reload] of [["Web", WebInspector, webQuery, webReload], ["Native", NativeInspector, nativeQuery, nativeReload]] as const) {
  it(`${platform}：ACP 上下文不挂载旧记忆或展示旧 MCP，legacy 仍可读取`, async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const readThreadMemory = vi.fn(() => Promise.resolve({ status: "ready" as const, summary: "旧会话记忆" }));
    const props = { contextOnly: true, projectId: "p", taskId: "task", projectName: "项目", projectPath: "/workspace", projectRootId: "root", gitClient: { readThreadMemory } as never,
      mcpServers: [{ name: "old", displayName: "旧 MCP 缓存", status: "connected" as const, toolCount: 1 }] };
    const wrap = (legacyContext: boolean) => <QueryClientProvider client={cache}><TooltipProvider><Inspector {...props} legacyContext={legacyContext} /></TooltipProvider></QueryClientProvider>;
    const screen = await render(wrap(false));
    await expect.element(screen.getByText("旧 MCP 缓存", { exact: true })).not.toBeInTheDocument();
    expect(readThreadMemory).not.toHaveBeenCalled();
    await screen.rerender(wrap(true));
    await expect.element(screen.getByText("旧会话记忆", { exact: true })).toBeVisible();
    expect(readThreadMemory).toHaveBeenCalledOnce();
    cache.clear();
  });
  it(`${platform}：手动刷新和变更不能绕过 runtime，ACP 不消费新鲜旧缓存`, async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const client = { listMcpServers: vi.fn(), retryMcpServers: vi.fn() };
    cache.setQueryData(query("p", "task", client).queryKey, { data: [] });
    for (const runtime of ["pending", "acp"] as const) {
      const options = query("p", "task", client, true, runtime);
      expect(options.enabled).toBe(false);
      await expect(cache.fetchQuery(options)).rejects.toThrow("MCP");
      await expect(reload("p", "task", client, runtime).mutationFn?.("reload", {} as never)).rejects.toThrow("MCP");
    }
    expect(client.listMcpServers).not.toHaveBeenCalled(); expect(client.retryMcpServers).not.toHaveBeenCalled(); cache.clear();
  });
}

it.each(["Web", "Native"] as const)("%s：后台任务在右栏上下文随会话状态更新", async (platform) => {
  const { createTaskStore: createWebStore } = await import("../../../apps/web/src/features/conversation/runtime/task-store.js");
  const { createTaskStore: createNativeStore } = await import("../../src/features/conversation/runtime/task-store.js");
  const { createResponse: webResponse } = await import("../../../apps/web/src/features/conversation/runtime/task-store.test-support.js");
  const { changeAppLanguage } = await import("../../../apps/web/src/i18n/i18n.js");
  const { i18n: nativeI18n } = await import("../../src/i18n/i18n.js");
  await changeAppLanguage("zh-CN");
  await nativeI18n.changeLanguage("zh-CN");
  const acpSession = {
    configOptions: [], availableCommands: [], foreground: "idle" as const,
    background: [
      { kind: "terminal" as const, id: "tests", label: "pnpm test", cancellable: true },
      { kind: "tool_call" as const, id: "watcher", label: "监视文件", cancellable: true },
      { kind: "subagent" as const, id: "child", label: "检查变更", cancellable: false },
    ],
  };
  const web = createWebStore({ projectId: "project-1", taskId: "task-1" });
  const native = createNativeStore({ projectId: "project-1", taskId: "task-1" });
  web.getState().hydrate(webResponse({ acpSession }));
  native.getState().hydrate(webResponse({ acpSession }));
  native.getState().setWriteAccess("writable");
  const store = platform === "Web" ? web : native;
  const Inspector = platform === "Web" ? WebInspector : NativeInspector;
  const cancel = vi.fn(async () => ({}));
  const cache = new QueryClient();
  const screen = await render(
    <QueryClientProvider client={cache}><TooltipProvider>
      <Inspector contextOnly legacyContext={false} projectId="project-1" taskId="task-1"
        projectName="项目" projectPath="/workspace" projectRootId="root"
        taskStore={store as never} onCancelAcpBackground={cancel} />
    </TooltipProvider></QueryClientProvider>,
  );
  await expect.element(screen.getByRole("region", { name: "后台任务" })).toBeVisible();
  await expect.element(screen.getByText("pnpm test", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("监视文件", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("检查变更", { exact: true })).toBeVisible();
  if (platform === "Native") native.getState().setWriteAccess("external");
  await expect.poll(() => document.querySelector('button[aria-label="停止 pnpm test"]') !== null)
    .toBe(platform === "Web");
  await expect.element(screen.getByText("pnpm test", { exact: true })).toBeVisible();
  if (platform === "Native") native.getState().setWriteAccess("writable");
  const stopButton = screen.getByRole("button", { name: "停止 pnpm test" });
  await expect.element(stopButton).toBeVisible();
  expect(stopButton.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(32);
  expect(stopButton.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
  await stopButton.click();
  expect(cancel).toHaveBeenCalledWith({ kind: "terminal", id: "tests" });
  const response = platform === "Web" ? webResponse({ acpSession: { ...acpSession, background: [] } }) :
    webResponse({ acpSession: { ...acpSession, background: [] } });
  if (platform === "Web") web.getState().hydrate(response as ReturnType<typeof webResponse>);
  else native.getState().hydrate(response as ReturnType<typeof webResponse>);
  await expect.element(screen.getByRole("region", { name: "后台任务" })).not.toBeInTheDocument();
  await screen.unmount();
  cache.clear();
});

it.each([["Web", "light", 260], ["Native", "dark", 360]] as const)(
  "%s：%s 主题的 %spx 右栏仅补充具体的回合停止原因",
  async (platform, theme, width) => {
    const { createTaskStore: createWebStore } = await import("../../../apps/web/src/features/conversation/runtime/task-store.js");
    const { createTaskStore: createNativeStore } = await import("../../src/features/conversation/runtime/task-store.js");
    const { createResponse, createPendingRequest, eventEnvelope, timestamp } = await import("../../../apps/web/src/features/conversation/runtime/task-store.test-support.js");
    const { changeAppLanguage } = await import("../../../apps/web/src/i18n/i18n.js");
    const { i18n: nativeI18n } = await import("../../src/i18n/i18n.js");
    const { page } = await import("vitest/browser");
    await changeAppLanguage("zh-CN");
    await nativeI18n.changeLanguage("zh-CN");
    const running = { id: "turn-running", items: [], status: "running" as const, error: null, startedAt: timestamp, completedAt: null };
    const session = { configOptions: [], availableCommands: [], foreground: "requires_action" as const };
    const plan = { explanation: null, steps: [{ status: "in_progress" as const, text: "验证双端" }] };
    const response = createResponse({
      acpSession: session,
      turns: [running],
      pendingRequests: [createPendingRequest()],
      plan,
      contextUsage: { usedTokens: 95_000, contextWindow: 100_000 },
    });
    const Inspector = platform === "Web" ? WebInspector : NativeInspector;
    const createStore = platform === "Web" ? createWebStore : createNativeStore;
    const store = createStore({ projectId: "project-1", taskId: "task-1" });
    store.getState().hydrate(response);
    const wrap = (taskId: string) => (
      <TooltipProvider>
        <div style={{ width }}>
          <Inspector contextOnly legacyContext={false} projectId="project-1" taskId={taskId}
            projectName="项目" projectPath="/workspace" projectRootId="root"
            task={{ turns: [], plan }} taskStore={store as never} />
        </div>
      </TooltipProvider>
    );
    document.documentElement.dataset.theme = theme;
    try {
      const screen = await render(wrap("task-1"));
      const details = screen.getByRole("region", { name: "回合详情" });
      const planRegion = screen.getByRole("region", { name: "计划", exact: true });
      await expect.element(planRegion).toBeVisible();
      await expect.element(screen.getByText("验证双端", { exact: true })).toBeVisible();
      await expect.element(screen.getByText("等待操作", { exact: true })).not.toBeInTheDocument();
      await expect.element(screen.getByText("1 项待处理", { exact: true })).not.toBeInTheDocument();
      await expect.element(screen.getByText("上下文窗口", { exact: true })).not.toBeInTheDocument();
      await expect.element(screen.getByRole("progressbar", { name: "计划进度" })).not.toBeInTheDocument();
      await expect.element(details).not.toBeInTheDocument();

      store.getState().applyEvents([
        { ...eventEnvelope(11), type: "turn.completed", turnId: running.id, payload: {
          turn: { ...running, status: "interrupted", stopReason: "max_tokens", completedAt: timestamp },
        } },
      ]);
      await expect.element(details.getByText("已达到 Token 上限", { exact: true })).toBeVisible();
      expect(details.element().scrollWidth).toBeLessThanOrEqual(details.element().clientWidth);
      expect(details.element().querySelector("h3")?.className)
        .toBe(planRegion.element().querySelector("h3")?.className);
      await page.screenshot({ path: `../../test-results/acp-turn-outcome-${platform}.png` });

      const background = { ...running, id: "background", acpBackground: true as const, status: "completed" as const, stopReason: "end_turn", completedAt: timestamp };
      const settled = { ...running, status: "completed" as const, completedAt: timestamp };
      store.getState().hydrate(createResponse({
        acpSession: { ...session, foreground: "idle" },
        turns: [{ ...settled, stopReason: "refusal" }, background],
      }));
      await expect.element(details.getByText("Agent 拒绝继续", { exact: true })).toBeVisible();
      await screen.rerender(wrap("other-task"));
      await expect.element(details).not.toBeInTheDocument();
      await screen.rerender(wrap("task-1"));
      store.getState().hydrate(createResponse({
        acpSession: { ...session, foreground: "idle" },
        turns: [{ ...settled, stopReason: "end_turn" }],
      }));
      await expect.element(details).not.toBeInTheDocument();
      await expect.element(screen.getByRole("region", { name: "任务概览" })).not.toBeInTheDocument();
      await screen.unmount();
    } finally {
      delete document.documentElement.dataset.theme;
    }
  },
);
