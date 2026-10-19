import { createHash } from "node:crypto";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { ClaudeHistory } from "./history.js";
import { paginateClaudeTurns, readClaudeHistoryPage } from "./history-pagination.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function history() {
  const root = await mkdtemp(join(tmpdir(), "claude-item-history-"));
  roots.push(root);
  return new ClaudeHistory(root);
}
const turn = (id: string, items: AgentItem[] = []): AgentTurn => ({
  id,
  items,
  status: "completed",
  startedAt: null,
  completedAt: null,
  error: null,
});
const message = (id: string): AgentItem => ({
  id,
  type: "message",
  role: "assistant",
  text: `中文 ${id}`,
});

it("keeps original item order across updates, restarts, new arrivals and older turn pages", async () => {
  const store = await history();
  for (let i = 0; i < 22; i++)
    await store.complete("task", turn(`turn-${String(i)}`, [message(`old-${String(i)}`)]));
  const items = Array.from({ length: 520 }, (_, index) => message(`item-${String(index)}`));
  await store.saveItems("task", "long", items);
  await store.complete("task", turn("long", items.slice(-10)));
  // 已有记录原位更新，不能因工具迟到结果被移到历史末尾。
  await store.saveItems("task", "long", [
    { id: "item-1", type: "tool", name: "Read", status: "completed", output: "迟到结果" },
  ]);
  let raw = await store.read("task");
  let page = await paginateClaudeTurns(store, "task", raw.turns, raw.cursor);
  expect(page.turns[0]?.items).toHaveLength(100);
  expect(page.turns[0]?.items[0]?.id).toBe("item-420");
  const cursor = page.cursor;
  expect(cursor).not.toBeNull();
  await expect(readClaudeHistoryPage(store, "different-task", cursor ?? undefined)).rejects.toThrow(
    "Invalid Claude history cursor",
  );
  // 分页期间新到达记录不应改变已经发出的向前游标。
  await store.saveItems("task", "long", [message("new-arrival")]);
  const restored = new ClaudeHistory(store.directory);
  const loaded: AgentItem[] = page.turns.flatMap((entry) => entry.items);
  const seen = new Set<string>();
  while (page.cursor) {
    expect(seen.has(page.cursor)).toBe(false);
    seen.add(page.cursor);
    const continuation = await readClaudeHistoryPage(restored, "task", page.cursor);
    if (continuation) page = continuation;
    else {
      raw = await restored.read("task", page.cursor);
      page = await paginateClaudeTurns(restored, "task", raw.turns, raw.cursor);
    }
    loaded.unshift(...page.turns.flatMap((entry) => entry.items));
  }
  expect(loaded.map((item) => item.id)).toEqual([
    ...Array.from({ length: 22 }, (_, i) => `old-${String(i)}`),
    ...items.map((item) => item.id),
  ]);
  expect(loaded.find((item) => item.id === "item-1")).toMatchObject({ output: "迟到结果" });
});

it("repairs a partial index append on retry without duplicating or dropping records", async () => {
  const store = await history();
  await store.saveItems("task", "turn", [message("first")]);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const index = join(store.items.directory, hash("task"), hash("turn"), "index");
  await appendFile(index, "partial");
  await new ClaudeHistory(store.directory).saveItems("task", "turn", [message("second")]);
  expect((await store.items.read("task", "turn"))?.items.map((item) => item.id)).toEqual([
    "first",
    "second",
  ]);
  await expect(store.items.read("task", "turn", 1)).rejects.toThrow("Invalid Claude item cursor");
  await expect(store.items.read("task", "turn", 1000000)).rejects.toThrow(
    "Invalid Claude item cursor",
  );
});

it("continues older legacy snapshots after the newest turn fills the first page", async () => {
  const store = await history();
  const older = turn("older", [message("old-record")]);
  const newest = turn(
    "newest",
    Array.from({ length: 110 }, (_, i) => message(`new-${String(i)}`)),
  );
  await store.complete("task", older);
  await store.complete("task", newest);
  // 旧版只有回合快照，没有记录索引；后续页仍须找到尚未显示的旧回合。
  await rm(store.items.directory, { recursive: true });
  const raw = await store.read("task");
  const first = await paginateClaudeTurns(store, "task", raw.turns, raw.cursor);
  expect(first.turns[0]?.items).toHaveLength(100);
  const next = await readClaudeHistoryPage(
    new ClaudeHistory(store.directory),
    "task",
    first.cursor ?? undefined,
  );
  expect(next?.turns.map((entry) => entry.id)).toEqual(["older", "newest"]);
  expect(next?.turns[0]?.items).toEqual(older.items);
  expect(next?.turns[1]?.items.map((item) => item.id)).toEqual(
    newest.items.slice(0, 10).map((item) => item.id),
  );
  expect(next?.cursor).toBeNull();
});

it("overlays live tokens and new records without saving or losing the disk continuation", async () => {
  const store = await history();
  const items = Array.from({ length: 120 }, (_, i) => message(`live-${String(i)}`));
  const value = turn("live", items);
  await store.checkpoint("task", value);
  const live = { ...value, items: [...items.slice(-100), message("new-record")] };
  live.items[live.items.length - 2] = {
    ...message("live-119"),
    type: "message",
    role: "assistant",
    text: "未落盘的 Token",
  };
  const page = await paginateClaudeTurns(
    store,
    "task",
    [live],
    null,
    undefined,
    new Map([[live.id, live]]),
  );
  expect(page.turns[0]?.items.map((item) => item.id)).toEqual([
    ...items.slice(21).map((item) => item.id),
    "new-record",
  ]);
  expect(page.turns[0]?.items.at(-2)).toMatchObject({ text: "未落盘的 Token" });
  const older = await readClaudeHistoryPage(store, "task", page.cursor ?? undefined);
  expect(older?.turns[0]?.items.map((item) => item.id)).toEqual(
    items.slice(0, 21).map((item) => item.id),
  );
  expect((await store.items.read("task", "live"))?.items.at(-1)).toMatchObject({
    id: "live-119",
    text: "中文 live-119",
  });
});

it("retries a legacy migration interrupted before turn metadata was committed", async () => {
  const store = await history();
  const value = turn("migration", [message("one")]);
  // saveItems 已建立正文及索引，但尚未提交回合元数据，模拟迁移中途退出。
  await store.saveItems("task", value.id, value.items);
  const restored = new ClaudeHistory(store.directory);
  const page = await paginateClaudeTurns(restored, "task", [value], null);
  expect(page.turns).toEqual([value]);
  expect(await restored.items.turn("task", value.id)).toEqual({ ...value, items: [] });
});

it("defers a live background turn when newer turns consume the remaining byte budget", async () => {
  const store = await history();
  const large = (id: string): AgentItem => ({
    id,
    type: "message",
    role: "assistant",
    text: "x".repeat(100 * 1024),
  });
  const older = turn("background", [large("old")]);
  const newest = turn("foreground", [large("new-1"), large("new-2"), large("new-3")]);
  await store.complete("task", older);
  await store.complete("task", newest);
  const first = await paginateClaudeTurns(
    store,
    "task",
    [older, newest],
    null,
    undefined,
    new Map([
      [older.id, older],
      [newest.id, newest],
    ]),
  );
  expect(first.turns.map((entry) => entry.id)).toEqual(["foreground"]);
  const next = await readClaudeHistoryPage(store, "task", first.cursor ?? undefined);
  expect(next?.turns).toEqual([older]);
});
