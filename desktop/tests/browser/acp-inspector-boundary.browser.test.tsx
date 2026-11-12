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
