import type { OfficialPluginPage, OfficialPluginSummary } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import {
  createPluginQueryInvalidator,
  getPluginCatalogChanges,
  refreshOfficialPlugins,
} from "./plugin-reconcile.js";

const empty = {
  changedPlugins: [],
  failedRemotePluginIds: [],
  failedMaterializationRemotePluginIds: [],
};
const result = {
  ...empty,
  changedPlugins: [
    { id: "changed", hasSkills: true, hasMcps: false, hasApps: true, hasHooks: false },
  ],
};

it("merges refreshes and applies change hints before loading the authoritative catalog", async () => {
  const order: string[] = [];
  const pending = Promise.withResolvers<typeof result>();
  const client = {
    reconcileOfficialPlugins: vi.fn(() => pending.promise),
    listOfficialPlugins: vi.fn(() => {
      order.push("list");
      return Promise.resolve({ data: [] });
    }),
  };
  const effects = {
    onReconciled: vi.fn(() => {
      order.push("changes");
    }),
    onCatalog: vi.fn(),
  };
  const first = refreshOfficialPlugins(client, effects);
  const second = refreshOfficialPlugins(client, effects);
  expect(client.listOfficialPlugins).not.toHaveBeenCalled();
  pending.resolve(result);
  expect(await first).toEqual(result);
  await second;
  expect(order).toEqual(["changes", "list"]);
  expect(client.reconcileOfficialPlugins).toHaveBeenCalledTimes(1);
  expect(effects.onCatalog).toHaveBeenCalledWith({ data: [] }, result);
  await refreshOfficialPlugins(client, effects);
  expect(client.reconcileOfficialPlugins).toHaveBeenCalledTimes(2);
});

it("invalidates only affected plugin details and skill or MCP catalogs", () => {
  const affected = createPluginQueryInvalidator(result);
  expect(affected(["extensions", "plugins", "detail", "market"], { id: "changed" })).toBe(true);
  expect(affected(["extensions", "plugins", "detail", "market"], { id: "other" })).toBe(false);
  expect(affected(["extensions", "skills"])).toBe(true);
  expect(affected(["projects", "p", "skills"])).toBe(true);
  expect(affected(["projects", "p", "tasks", "t", "mcp-servers"])).toBe(false);
  expect(affected(["projects", "p", "tasks"])).toBe(false);
  expect(affected(["extensions", "plugins"])).toBe(false);
  expect(createPluginQueryInvalidator(empty)(["extensions", "skills"])).toBe(false);
  const mcps = createPluginQueryInvalidator({
    ...empty,
    changedPlugins: [
      { id: "changed", hasApps: true, hasHooks: false, hasSkills: false, hasMcps: true },
    ],
  });
  expect(mcps(["projects", "p", "tasks", "t", "mcp-servers"])).toBe(true);
  expect(mcps(["extensions", "mcp"])).toBe(false); // 全局配置列表不包含插件服务器。
});

it("retains partial failure results and permits retry after transport failure", async () => {
  const client = {
    reconcileOfficialPlugins: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ...empty, failedRemotePluginIds: ["failed"] }),
    listOfficialPlugins: vi.fn(() => Promise.resolve({ data: [] })),
  };
  const effects = { onReconciled: vi.fn(), onCatalog: vi.fn() };
  await expect(refreshOfficialPlugins(client, effects)).rejects.toThrow("offline");
  expect(client.listOfficialPlugins).not.toHaveBeenCalled();
  expect((await refreshOfficialPlugins(client, effects)).failedRemotePluginIds).toEqual(["failed"]);
});

it("invalidates a changed plugin detail that is still loading", () => {
  const catalog = {
    data: [
      { id: "changed", marketplaceName: "remote", marketplacePath: null, pluginName: "remote-id" },
    ],
  } as OfficialPluginPage;
  expect(
    createPluginQueryInvalidator(
      result,
      catalog,
    )(["extensions", "plugins", "detail", "remote", null, "remote-id"]),
  ).toBe(true);
});

it("detects catalog state changes already consumed by a background reconciliation", () => {
  const plugin = {
    id: "changed",
    enabled: true,
    installed: true,
    localVersion: "1",
    version: "2",
  } as OfficialPluginSummary;
  const previous = { data: [plugin] };
  expect(getPluginCatalogChanges(previous, previous).changedPlugins).toEqual([]);
  const next = { data: [{ ...plugin, localVersion: "2" }] };
  expect(getPluginCatalogChanges(previous, next).changedPlugins).toEqual([
    { id: "changed", hasApps: true, hasHooks: true, hasMcps: true, hasSkills: true },
  ]);
  expect(getPluginCatalogChanges(previous, { data: [] }).changedPlugins).toHaveLength(1);
  expect(getPluginCatalogChanges(undefined, next).changedPlugins).toEqual([]);
});
