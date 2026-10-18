import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentTurn } from "@codexly/protocol";
import { ClaudeHistory } from "./history.js";
import { paginateClaudeTurns } from "./history-pagination.js";
import { createHash } from "node:crypto";

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

it("reads summary messages without opening raw history, checkpoints or tool bodies after restart", async () => {
  const history = await setup();
  const question = {
    id: "question",
    type: "message" as const,
    role: "user" as const,
    text: "问题",
  };
  const answer = {
    id: "answer",
    type: "message" as const,
    role: "assistant" as const,
    text: "答复",
  };
  const tools = Array.from({ length: 120 }, (_, i) => ({
    id: `tool-${String(i)}`,
    type: "tool" as const,
    name: "Read",
    status: "completed" as const,
    output: "工具正文".repeat(1000),
  }));
  await history.complete("task", {
    ...turn(),
    status: "completed",
    items: [question, ...tools, answer],
  });
  await history.checkpoint("task", { ...turn(), id: "active", items: [question, ...tools] });
  const restored = new ClaudeHistory(history.directory);
  vi.clearAllMocks();
  expect((await restored.readSummary("task")).turns[0]?.items).toEqual([question, answer]);
  expect((await restored.activeSummary("task"))?.items).toEqual([question]);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const toolKeys = new Set(tools.map((item) => hash(item.id)));
  for (const [path] of vi.mocked(fs.readFile).mock.calls) {
    expect(typeof path).toBe("string");
    const filename = typeof path === "string" ? (path.split(/[\\/]/u).at(-1) ?? "") : "";
    expect(toolKeys.has(filename), filename).toBe(false);
    expect(filename).not.toMatch(/\.(?:jsonl|active|turn)$/u);
  }
  for (const [path] of vi.mocked(fs.open).mock.calls)
    expect(String(path)).not.toMatch(/\.(?:jsonl|active)$/u);
  expect(fs.writeFile).not.toHaveBeenCalled();
  expect(fs.mkdir).not.toHaveBeenCalled();
});
