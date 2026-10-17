import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentTurn } from "@codexly/protocol";
import { ClaudeHistory } from "./history.js";
import { paginateClaudeTurns } from "./history-pagination.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof fs>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === "function" ? vi.fn(value as (...args: unknown[]) => unknown) : value,
    ]),
  );
});
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const turn = (): AgentTurn => ({
  id: "turn",
  status: "running",
  startedAt: null,
  completedAt: null,
  error: null,
  items: Array.from({ length: 512 }, (_, i) => ({
    id: `item-${String(i)}`,
    type: "message",
    role: "assistant",
    text: "x".repeat(200),
  })),
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "claude-io-"));
  roots.push(root);
  return new ClaudeHistory(root);
}

it("performs zero filesystem calls for three unchanged checkpoints after prewriting 512 items", async () => {
  const history = await setup();
  const value = turn();
  await history.checkpoint("task", value);
  vi.clearAllMocks();
  for (let i = 0; i < 3; i++) await history.checkpoint("task", structuredClone(value));
  for (const key of ["readFile", "writeFile", "open", "mkdir", "rename", "rm"] as const)
    expect(fs[key], key).not.toHaveBeenCalled();
});

it("writes only the changed body without reading stable item bodies", async () => {
  const history = await setup();
  const value = turn();
  await history.checkpoint("task", value);
  assert(value.items[200]);
  value.items[200] = { ...value.items[200], type: "message", role: "assistant", text: "changed" };
  vi.clearAllMocks();
  await history.checkpoint("task", value);
  expect(fs.readFile).not.toHaveBeenCalled();
  // 正文与检查点各一次，回合元数据未变化。
  expect(fs.writeFile).toHaveBeenCalledTimes(2);
  expect(
    (await history.items.read("task", "turn", 201 * 64, undefined, 1))?.items[0],
  ).toMatchObject({ id: "item-200", text: "changed" });
});

it("does not enqueue writes or rewrite turn metadata when paging an indexed turn", async () => {
  const history = await setup();
  const value = turn();
  await history.checkpoint("task", value);
  const restored = new ClaudeHistory(history.directory);
  vi.clearAllMocks();
  await paginateClaudeTurns(restored, "task", [value], null);
  expect(fs.writeFile).not.toHaveBeenCalled();
  expect(fs.mkdir).not.toHaveBeenCalled();
});
