import { useEngineProfileInvalidation } from "@codexly/ui/core/engine-profile-invalidation";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentEngineProfile } from "@codexly/protocol";
import { engineProfileQuery } from "@codexly/frontend-core/engine-settings-query";
import { useEngineComposerState } from "@codexly/ui/core/engine-composer-state";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import { useCallback, useState } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

it("keeps Codex ready and restores cached Claude controls across new drafts", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 100 } } });
  let resolve!: (profile: AgentEngineProfile) => void;
  const load = vi.fn(() => new Promise<AgentEngineProfile>((done) => { resolve = done; }));
  function Composer({ scope, engine }: { scope: string; engine: "codex" | "claude" }) {
    const query = useQueryClient();
    useQuery({ ...engineProfileQuery(load, "claude", "project"), enabled: false });
    const read = useCallback(() => query.fetchQuery(engineProfileQuery(load, "claude", "project")), [query]);
    const state = useEngineComposerState({ scope, profileScope: "project", initialEngine: engine,
      taskId: undefined, taskEngine: undefined, codexConfigured: true, load: read,
      cachedProfile: query.getQueryData(["engine-profile", "claude", "project"]) });
    return <output>{state.engine}:{state.pending ? "pending" : "ready"}</output>;
  }
  function Harness() {
    useEngineProfileInvalidation();
    const [draft, setDraft] = useState(0);
    return <><button onClick={() => setDraft((value) => value + 1)}>新聊天</button>
      <Composer key={draft} scope={`draft-${draft}`} engine={draft ? "claude" : "codex"} /></>;
  }
  const screen = await render(<QueryClientProvider client={client}><SelectedEnginesContext value={["codex", "claude"]}><Harness /></SelectedEnginesContext></QueryClientProvider>);
  await expect.element(screen.getByText("codex:ready")).toBeVisible();
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  resolve({ engine: "claude", connection: { state: "connected" } } as AgentEngineProfile);
  await vi.waitFor(() => expect(client.getQueryData(["engine-profile", "claude", "project"])).toBeDefined());
  // 跨过空闲缓存回收时间，模拟长时间停留在历史会话后再新建聊天。
  await new Promise<void>((done) => { setTimeout(done, 150); });
  await screen.getByRole("button", { name: "新聊天" }).click();
  await expect.element(screen.getByText("claude:ready")).toBeVisible();
  expect(load).toHaveBeenCalledTimes(1);
  await screen.unmount();
  client.clear();
});

it("invalidates cached engine profiles when settings change while no composer is mounted", async () => {
  const client = new QueryClient();
  const key = ["engine-profile", "claude", "project"];
  client.setQueryData(key, { engine: "claude" });
  function Settings() {
    useEngineProfileInvalidation();
    return <button onClick={() => window.dispatchEvent(new Event("codexly:engine-settings-changed"))}>保存设置</button>;
  }
  const screen = await render(<QueryClientProvider client={client}><Settings /></QueryClientProvider>);
  await screen.getByRole("button", { name: "保存设置" }).click();
  expect(client.getQueryData(key)).toBeUndefined();
  await screen.unmount();
  client.clear();
});

it("discards an older discovery response after settings change", async () => {
  const client = new QueryClient();
  let resolveOld!: (profile: AgentEngineProfile) => void;
  const oldPromise = new Promise<AgentEngineProfile>((resolve) => { resolveOld = resolve; });
  const key = ["engine-profile", "claude", "project"];
  const load = vi.fn(() => oldPromise);
  const reading = client.fetchQuery({ queryKey: key, queryFn: load }).catch(() => undefined);
  function Settings() {
    useEngineProfileInvalidation();
    return <button onClick={() => window.dispatchEvent(new Event("codexly:engine-settings-changed"))}>保存设置</button>;
  }
  const screen = await render(<QueryClientProvider client={client}><Settings /></QueryClientProvider>);
  await screen.getByRole("button", { name: "保存设置" }).click();
  resolveOld({ engine: "claude" } as AgentEngineProfile);
  await reading;
  expect(client.getQueryData(key)).toBeUndefined();
  await screen.unmount();
  client.clear();
});
