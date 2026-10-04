import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { I18nextProvider, i18n } from "../../i18n/i18n.js";
import { OfficialPluginsPane } from "./official-plugins-pane.js";

const client = vi.hoisted(() => ({ listOfficialPlugins: vi.fn(), reconcileOfficialPlugins: vi.fn() }));
vi.mock("../projects/project-context.js", () => ({ useProjectData: () => ({ client }) }));

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("zh-CN");
  client.listOfficialPlugins.mockResolvedValue({ data: [] });
});

it("synchronizes on refresh, disables repeated clicks, and shows partial failure without claiming readiness", async () => {
  let resolve!: (value: unknown) => void;
  const pending = { promise: new Promise<unknown>((done) => { resolve = done; }), resolve: (value: unknown) => resolve(value) };
  client.reconcileOfficialPlugins.mockReturnValue(pending.promise);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["projects", "p", "skills"], { data: [] });
  cache.setQueryData(["projects", "p", "tasks", "t", "mcp-servers"], { data: [] });
  await render(<I18nextProvider i18n={i18n}><QueryClientProvider client={cache}><OfficialPluginsPane /></QueryClientProvider></I18nextProvider>);
  const refresh = page.getByRole("button", { name: "刷新官方插件" });
  await expect.element(refresh).toBeEnabled();
  expect(client.reconcileOfficialPlugins).not.toHaveBeenCalled();
  await refresh.click();
  await expect.poll(() => client.reconcileOfficialPlugins.mock.calls.length).toBe(1);
  await expect.element(refresh).toBeDisabled();
  pending.resolve({ changedPlugins: [{ id: "removed", hasSkills: true, hasMcps: false, hasApps: false, hasHooks: false }], failedRemotePluginIds: ["failed"], failedMaterializationRemotePluginIds: [] });
  await expect.element(page.getByRole("alert")).toHaveTextContent("部分插件同步失败，请重试");
  await expect.element(refresh).toBeEnabled();
  expect(client.listOfficialPlugins).toHaveBeenLastCalledWith(true);
  expect(cache.getQueryState(["projects", "p", "skills"])?.isInvalidated).toBe(true);
  expect(cache.getQueryState(["projects", "p", "tasks", "t", "mcp-servers"])?.isInvalidated).toBe(false);
});

it("reports transport failure and allows a subsequent retry", async () => {
  client.reconcileOfficialPlugins.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ changedPlugins: [], failedRemotePluginIds: [], failedMaterializationRemotePluginIds: [] });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(<I18nextProvider i18n={i18n}><QueryClientProvider client={cache}><OfficialPluginsPane /></QueryClientProvider></I18nextProvider>);
  const refresh = page.getByRole("button", { name: "刷新官方插件" });
  await expect.element(refresh).toBeEnabled();
  await refresh.click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("插件同步失败，请重试");
  await refresh.click();
  await expect.poll(() => client.listOfficialPlugins.mock.calls.length).toBe(2);
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});
