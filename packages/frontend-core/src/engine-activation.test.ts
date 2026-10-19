import { expect, it, vi } from "vitest";
import { createEngineActivation } from "./engine-activation.js";

it.each([
  ["codex", "claude"],
  ["claude", "codex"],
] as const)("enables %s from %s only after preparation succeeds", async (engine, existing) => {
  const persist = vi.fn();
  const store = createEngineActivation([existing], persist);
  const deferred = Promise.withResolvers<undefined>();
  const prepare = vi.fn((report: (message: string) => void) => {
    report("50%");
    return deferred.promise;
  });
  expect(prepare).not.toHaveBeenCalled();
  const result = store.enable(engine, prepare);
  expect(store.getSnapshot().states[engine]).toEqual({ phase: "preparing", message: "50%" });
  expect(store.getSnapshot().engines).toEqual([existing]);
  expect(persist).not.toHaveBeenCalled();
  const repeated = store.enable(engine, prepare);
  expect(prepare).toHaveBeenCalledTimes(1);
  deferred.resolve(undefined);
  await Promise.all([result, repeated]);
  expect(store.getSnapshot().engines).toEqual([existing, engine]);
  expect(persist).toHaveBeenCalledWith([existing, engine]);
});
it("keeps configuration locked on failure and retries without losing the other engine", async () => {
  const persist = vi.fn();
  const store = createEngineActivation(["codex"], persist);
  await expect(store.enable("claude", () => Promise.reject(new Error("offline")))).rejects.toThrow(
    "offline",
  );
  expect(store.getSnapshot().engines).toEqual(["codex"]);
  expect(store.getSnapshot().states.claude.phase).toBe("failed");
  expect(persist).not.toHaveBeenCalled();
  await store.enable("claude", () => Promise.resolve());
  expect(store.getSnapshot().engines).toEqual(["codex", "claude"]);
});
it("publishes changes to mounted consumers and keeps completed activations idempotent", async () => {
  const store = createEngineActivation(["claude"], vi.fn());
  const listener = vi.fn();
  const stop = store.subscribe(listener);
  await store.enable("codex", () => Promise.resolve());
  expect(listener).toHaveBeenCalled();
  const prepare = vi.fn();
  await store.enable("codex", prepare);
  expect(prepare).not.toHaveBeenCalled();
  stop();
});
it("does not mark enabled when persistence fails", async () => {
  const store = createEngineActivation(["codex"], () => {
    throw new Error("storage failed");
  });
  await expect(store.enable("claude", () => Promise.resolve())).rejects.toThrow("storage failed");
  expect(store.getSnapshot().engines).toEqual(["codex"]);
});
