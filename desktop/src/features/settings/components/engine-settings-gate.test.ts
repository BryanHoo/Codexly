import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { PrepareEngine } from "@codexly/frontend-core/engine-activation";
import { createEngineActivation } from "@codexly/frontend-core/engine-activation";
const mocks = vi.hoisted(() => ({
  claude: vi.fn(),
  codex: vi.fn(),
  start: vi.fn(),
  invalidate: vi.fn(),
  cache: vi.fn(),
  prepare: undefined as PrepareEngine | undefined,
}));
vi.mock("@codexly/ui/core/engine-settings-gate", () => ({
  EngineSettingsGate: (props: { prepare: PrepareEngine }) => {
    mocks.prepare = props.prepare;
    return null;
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate, setQueryData: mocks.cache }),
}));
vi.mock("../../../i18n/i18n.js", () => ({ getCurrentLanguage: () => "zh-CN" }));
vi.mock("../../../platform/tauri/claude-runtime-manager.js", () => ({
  prepareClaudeRuntime: mocks.claude,
}));
vi.mock("../../../platform/tauri/codex-runtime-manager.js", () => ({
  downloadAndInspectCodexRuntime: mocks.codex,
}));
vi.mock("../../../platform/tauri/runtime.js", () => ({ ensureCodexRuntime: mocks.start }));
import { EngineSettingsGate } from "./engine-settings-gate.js";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.codex.mockResolvedValue({ status: "compatible" });
  mocks.claude.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
});
it.each(["codex", "claude"] as const)(
  "only installs %s after the enable action and persists after preparation",
  async (engine) => {
    renderToStaticMarkup(createElement(EngineSettingsGate, { engine }, createElement("input")));
    expect(mocks.codex).not.toHaveBeenCalled();
    expect(mocks.claude).not.toHaveBeenCalled();
    const persist = vi.fn();
    const store = createEngineActivation([engine === "codex" ? "claude" : "codex"], persist);
    await store.enable(engine, mocks.prepare!);
    expect(engine === "codex" ? mocks.codex : mocks.claude).toHaveBeenCalledOnce();
    expect(engine === "codex" ? mocks.claude : mocks.codex).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledTimes(engine === "codex" ? 1 : 0);
  },
);
it("keeps Codex disabled when the installer reports an incompatible runtime", async () => {
  mocks.codex.mockResolvedValue({ status: "incompatible" });
  renderToStaticMarkup(
    createElement(EngineSettingsGate, { engine: "codex" }, createElement("input")),
  );
  const persist = vi.fn();
  const store = createEngineActivation(["claude"], persist);
  await expect(store.enable("codex", mocks.prepare!)).rejects.toThrow("unavailable");
  expect(mocks.start).not.toHaveBeenCalled();
  expect(persist).not.toHaveBeenCalled();
});
