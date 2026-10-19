import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentTurn } from "@codexly/protocol";
import { ClaudeHistory } from "./history.js";

const clock = vi.hoisted(() => ({ elapsed: 0 }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof fs>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn((milliseconds: number) => {
    clock.elapsed += milliseconds;
    return Promise.resolve();
  }),
}));

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clock.elapsed = 0;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function lockedHistory(platform: string, code: string, duration: number) {
  const { rename } = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.rename).mockImplementation(rename);
  const root = await fs.mkdtemp(join(tmpdir(), "claude-storage-lock-"));
  roots.push(root);
  const history = new ClaudeHistory(root);
  const turn: AgentTurn = {
    id: "turn",
    status: "running",
    startedAt: null,
    completedAt: null,
    error: null,
    items: [{ id: "reply", type: "message", role: "assistant", text: "before" }],
  };
  await history.checkpoint("task", turn);
  vi.stubGlobal("process", { ...process, platform });
  const failure = Object.assign(new Error("Storage replacement is locked"), { code });
  vi.mocked(fs.rename).mockImplementation(async (source, destination) => {
    if (clock.elapsed < duration) throw failure;
    await rename(source, destination);
  });
  const update = () =>
    history.checkpoint("task", {
      ...turn,
      items: [{ id: "reply", type: "message", role: "assistant", text: "after" }],
    });
  return { root, history, update, failure };
}

it.each(["EPERM", "EACCES", "EBUSY"])(
  "recovers Claude history from a transient Windows lock (%s)",
  async (code) => {
    const { root, history, update } = await lockedHistory("win32", code, 1_000);
    await expect(update()).resolves.toBeUndefined();
    expect((await history.items.read("task", "turn"))?.items[0]).toMatchObject({ text: "after" });
    expect(
      (await fs.readdir(root, { recursive: true })).some((name) => name.endsWith(".tmp")),
    ).toBe(false);
  },
);

it("bounds persistent lock retries and preserves the previous history", async () => {
  const { root, history, update, failure } = await lockedHistory("win32", "EPERM", Infinity);
  await expect(update()).rejects.toBe(failure);
  expect(clock.elapsed).toBeGreaterThanOrEqual(1_000);
  expect(clock.elapsed).toBeLessThan(4_000);
  expect((await history.items.read("task", "turn"))?.items[0]).toMatchObject({ text: "before" });
  expect((await fs.readdir(root, { recursive: true })).some((name) => name.endsWith(".tmp"))).toBe(
    false,
  );
});

it.each([
  ["linux", "EPERM"],
  ["darwin", "EBUSY"],
  ["win32", "ENOENT"],
] as const)("does not retry unrelated storage failures (%s, %s)", async (platform, code) => {
  const { update, failure } = await lockedHistory(platform, code, Infinity);
  await expect(update()).rejects.toBe(failure);
  expect(clock.elapsed).toBe(0);
});
