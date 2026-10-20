import { expect, it } from "vitest";
import type { ClaudeExtensionPage } from "@codexly/protocol";
import { reconcileClaudeExtensionMutation } from "./claude-extension-cache.js";

const page = (installed: readonly string[]): ClaudeExtensionPage => ({
  data: ["alpha", "beta"].map((name) => ({
    id: name,
    name,
    scope: "user",
    installed: installed.includes(name),
    enabled: installed.includes(name),
    mutable: true,
    description: "Plugin",
  })),
});

it("preserves both completed installations when full catalog responses arrive out of order", () => {
  const newer = reconcileClaudeExtensionMutation(page([]), page(["beta"]), {
    kind: "plugins",
    action: "install",
    id: "beta",
    scope: "user",
  });
  const final = reconcileClaudeExtensionMutation(newer, page(["alpha"]), {
    kind: "plugins",
    action: "install",
    id: "alpha",
    scope: "user",
  });
  expect(final.data.map((item) => [item.id, item.installed])).toEqual([
    ["alpha", true],
    ["beta", true],
  ]);
});

it("removes only the requested plugin and retains another completed operation", () => {
  const result = reconcileClaudeExtensionMutation(
    page(["alpha", "beta"]),
    { data: [] },
    { kind: "plugins", action: "uninstall", id: "alpha", scope: "user" },
  );
  expect(result.data.map((item) => [item.id, item.installed])).toEqual([["beta", true]]);
});

it("keeps an installation confirmed while a slower catalog sync is still in progress", () => {
  const baseline = page([]);
  const current = reconcileClaudeExtensionMutation(baseline, page(["alpha"]), {
    kind: "plugins",
    action: "install",
    id: "alpha",
    scope: "user",
  });
  const result = reconcileClaudeExtensionMutation(
    current,
    page([]),
    { kind: "plugins", action: "sync", id: "claude-plugins-official", scope: "user" },
    baseline,
  );
  expect(result.data.find((item) => item.id === "alpha")?.installed).toBe(true);
});
