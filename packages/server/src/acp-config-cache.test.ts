import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import { closeCallbacks, createProvider, createServerOptions } from "./app-all.test-support.js";
import type { AcpConfigPreview, AgentEngine } from "@codexly/protocol";

it("启动缓存读取不启动 Agent，刷新失败仍返回上一次快照", async () => {
  const saved = { configOptions: [], values: { raw: false } };
  const read = vi.fn((engine: AgentEngine): Promise<AcpConfigPreview | null> =>
    Promise.resolve(engine === "codex" ? saved : null),
  );
  const refresh = vi.fn((_engine: AgentEngine, _signal?: AbortSignal) =>
    Promise.reject(new Error("ACP_AUTH_REQUIRED")),
  );
  const list = vi.fn((_discover?: boolean) => Promise.resolve({ agents: [] }));
  const settings = {
    profile: {
      engine: "codex" as const,
      protocolVersion: 1,
      authMethods: [],
    },
  };
  const readSettings = vi.fn((engine: AgentEngine) =>
    Promise.resolve(engine === "codex" ? settings : null),
  );
  const refreshSettings = vi.fn((_engine: AgentEngine, _signal?: AbortSignal) =>
    Promise.resolve(settings),
  );
  const options = createServerOptions(createProvider().provider);
  const service = {
    inspect: vi.fn(),
    readDefaults: vi.fn(),
    updateDefaults: vi.fn(),
    setDefaultConfig: vi.fn(),
    authenticate: vi.fn(),
  };
  const app = await createCodexlyServer({
    ...options,
    acpAgents: {
      codex: service,
      claude: service,
      startupConfig: { read, refresh, settings: { read: readSettings, refresh: refreshSettings } },
      catalog: { list, install: vi.fn(), configure: vi.fn() },
    },
  });
  closeCallbacks.push(() => app.close());
  const registry = await app.inject({ method: "GET", url: "/v1/acp/registry?cached=true" });
  expect(registry.statusCode, registry.body).toBe(200);
  expect(list).toHaveBeenCalledExactlyOnceWith(false);
  const path = "/v1/acp/agents";
  const hit = await app.inject({ method: "GET", url: `${path}/codex/config-cache` });
  const miss = await app.inject({ method: "GET", url: `${path}/claude/config-cache` });
  expect(hit.statusCode, hit.body).toBe(200);
  expect(hit.json()).toEqual(saved);
  expect(miss.statusCode, miss.body).toBe(200);
  expect(miss.json()).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
  const failure = await app.inject({
    method: "POST",
    url: `${path}/codex/config-cache`,
    payload: {},
  });
  expect(failure.statusCode, failure.body).toBe(200);
  expect(failure.json()).toEqual(saved);
  expect(refresh).toHaveBeenCalledExactlyOnceWith("codex", expect.any(AbortSignal));
  const snapshotUrl = `${path}/codex/settings-snapshot`;
  const snapshot = await app.inject({ method: "GET", url: snapshotUrl });
  expect(snapshot.statusCode, snapshot.body).toBe(200);
  expect(snapshot.headers["cache-control"]).toBe("no-store");
  expect(snapshot.json()).toEqual(settings);
  expect(refreshSettings).not.toHaveBeenCalled();
  const refreshed = await app.inject({ method: "POST", url: snapshotUrl, payload: {} });
  expect(refreshed.statusCode, refreshed.body).toBe(200);
  expect(refreshed.json()).toEqual(settings);
  expect(refreshSettings).toHaveBeenCalledExactlyOnceWith("codex", expect.any(AbortSignal));
  expect(service.inspect).not.toHaveBeenCalled();
  expect(service.readDefaults).not.toHaveBeenCalled();
});
