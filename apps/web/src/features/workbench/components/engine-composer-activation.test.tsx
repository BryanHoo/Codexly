import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import { useEngineComposerState } from "@codexly/ui/core/engine-composer-state";
import type { AgentEngineProfile } from "@codexly/protocol";
const { effects } = vi.hoisted(() => ({ effects: [] as React.EffectCallback[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useEffect: (effect: React.EffectCallback) => {
    effects.push(effect);
  },
}));
beforeEach(() => {
  effects.length = 0;
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());
it.each([
  ["codex", 0],
  ["claude", 1],
] as const)("only discovers Claude after explicit selection: %s", async (enabled, calls) => {
  const load = vi.fn(() =>
    Promise.resolve({ connection: { state: "disconnected" } } as AgentEngineProfile),
  );
  function Composer() {
    const state = useEngineComposerState({
      scope: "p",
      taskId: undefined,
      taskEngine: undefined,
      codexConfigured: false,
      load,
    });
    return <span>{String(state.pending)}</span>;
  }
  renderToStaticMarkup(
    <SelectedEnginesContext value={[enabled]}>
      <Composer />
    </SelectedEnginesContext>,
  );
  const cleanup = effects.map((effect) => effect());
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(calls);
  for (const stop of cleanup) if (typeof stop === "function") stop();
});
it("does not wait for an unenabled Codex connection on a Claude-only workspace", () => {
  function Composer() {
    const state = useEngineComposerState({
      scope: "p",
      taskId: "task",
      taskEngine: "codex",
      codexConfigured: undefined,
      claudeSupported: false,
      load: vi.fn(),
    });
    return (
      <span>
        {String(state.pending)}:{String(state.codexConfigured)}
      </span>
    );
  }
  const markup = renderToStaticMarkup(
    <SelectedEnginesContext value={["claude"]}>
      <Composer />
    </SelectedEnginesContext>,
  );
  expect(markup).toContain("false:false");
});

it("does not silently switch a Claude-only draft to an unenabled Codex while discovering configuration", () => {
  function Composer() {
    const state = useEngineComposerState({
      scope: "p",
      taskId: undefined,
      taskEngine: undefined,
      codexConfigured: false,
      load: vi.fn(),
    });
    return <span>{state.engine}</span>;
  }
  const markup = renderToStaticMarkup(
    <SelectedEnginesContext value={["claude"]}>
      <Composer />
    </SelectedEnginesContext>,
  );
  expect(markup).toContain("claude");
});

it("keeps a configured Codex draft ready while Claude discovery is still pending", () => {
  function Composer() {
    const state = useEngineComposerState({
      scope: "p",
      taskId: undefined,
      taskEngine: undefined,
      codexConfigured: true,
      load: () => Promise.withResolvers<AgentEngineProfile>().promise,
    });
    return (
      <span>
        {state.engine}:{String(state.pending)}
      </span>
    );
  }
  expect(
    renderToStaticMarkup(
      <SelectedEnginesContext value={["codex", "claude"]}>
        <Composer />
      </SelectedEnginesContext>,
    ),
  ).toContain("codex:false");
});

it("restores a cached Claude profile synchronously when mounting a new draft", () => {
  function Composer() {
    const state = useEngineComposerState({
      scope: "new-draft",
      profileScope: "p",
      taskId: undefined,
      taskEngine: undefined,
      initialEngine: "claude",
      codexConfigured: true,
      cachedProfile: { engine: "claude", connection: { state: "connected" } } as AgentEngineProfile,
      load: vi.fn(),
    });
    return (
      <span>
        {state.engine}:{String(state.pending)}
      </span>
    );
  }
  expect(
    renderToStaticMarkup(
      <SelectedEnginesContext value={["codex", "claude"]}>
        <Composer />
      </SelectedEnginesContext>,
    ),
  ).toContain("claude:false");
});

it("waits for discovery when Codex is disconnected and Claude may be the available engine", () => {
  function Composer() {
    const state = useEngineComposerState({
      scope: "disconnected",
      taskId: undefined,
      taskEngine: undefined,
      codexConfigured: false,
      load: () => Promise.withResolvers<AgentEngineProfile>().promise,
    });
    return <span>{String(state.pending)}</span>;
  }
  expect(
    renderToStaticMarkup(
      <SelectedEnginesContext value={["codex", "claude"]}>
        <Composer />
      </SelectedEnginesContext>,
    ),
  ).toContain("true");
});

it("does not unlock a draft before Codex discovery confirms whether engine fallback is necessary", () => {
  function Composer() {
    const state = useEngineComposerState({
      scope: "await-connection",
      taskId: undefined,
      taskEngine: undefined,
      codexConfigured: undefined,
      cachedProfile: { engine: "claude", connection: { state: "connected" } } as AgentEngineProfile,
      load: vi.fn(),
    });
    return <span>{String(state.pending)}</span>;
  }
  expect(
    renderToStaticMarkup(
      <SelectedEnginesContext value={["codex", "claude"]}>
        <Composer />
      </SelectedEnginesContext>,
    ),
  ).toContain("true");
});

it.each(["codex", "claude"] as const)("单引擎 %s 跳过草稿选择的读取和写入", (enabled) => {
  const storage = { getItem: vi.fn(() => "claude"), setItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  let select!: (engine: "codex" | "claude") => void;
  function Composer() {
    const state = useEngineComposerState({
      scope: "single-engine",
      taskId: undefined,
      taskEngine: undefined,
      codexConfigured: true,
      cachedProfile: { connection: { state: "connected" } } as AgentEngineProfile,
      load: vi.fn(),
    });
    select = state.select;
    return <span>{state.engine}</span>;
  }
  expect(
    renderToStaticMarkup(
      <SelectedEnginesContext value={[enabled]}>
        <Composer />
      </SelectedEnginesContext>,
    ),
  ).toContain(enabled);
  select(enabled === "codex" ? "claude" : "codex");
  expect(storage.getItem).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("仅 Codex 时跳过 Claude 配置监听、刷新和发现", () => {
  const listen = vi.spyOn(window, "addEventListener");
  const invalidateProfile = vi.fn();
  const load = vi.fn();
  let refresh!: () => void;
  function Composer() {
    const state = useEngineComposerState({
      scope: "codex-only",
      taskId: undefined,
      taskEngine: undefined,
      codexConfigured: true,
      invalidateProfile,
      load,
    });
    refresh = state.refresh;
    return (
      <span>
        {state.engine}:{String(state.pending)}
      </span>
    );
  }
  expect(
    renderToStaticMarkup(
      <SelectedEnginesContext value={["codex"]}>
        <Composer />
      </SelectedEnginesContext>,
    ),
  ).toContain("codex:false");
  const cleanup = effects.map((effect) => effect());
  refresh();
  window.dispatchEvent(new Event("codexly:engine-settings-changed"));
  expect(listen).not.toHaveBeenCalled();
  expect(invalidateProfile).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  for (const stop of cleanup) if (typeof stop === "function") stop();
});
