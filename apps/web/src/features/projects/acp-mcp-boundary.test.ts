import { expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  mcpServersQueryOptions,
  mcpServersReloadMutationOptions,
} from "./project-query-options.js";

it.each(["acp", "pending"] as const)(
  "%s 不能自动或手动读取旧 MCP，也不能重新连接",
  async (runtime) => {
    const client = { listMcpServers: vi.fn(), retryMcpServers: vi.fn() };
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = mcpServersQueryOptions("p", "task", client, true, runtime);
    expect(options.enabled).toBe(false);
    await expect(cache.fetchQuery(options)).rejects.toThrow("MCP");
    const mutation = mcpServersReloadMutationOptions("p", "task", client, runtime);
    await expect(mutation.mutationFn?.(undefined, {} as never)).rejects.toThrow("MCP");
    expect(client.listMcpServers).not.toHaveBeenCalled();
    expect(client.retryMcpServers).not.toHaveBeenCalled();
    cache.clear();
  },
);
