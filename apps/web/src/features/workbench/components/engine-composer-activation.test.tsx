import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
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
