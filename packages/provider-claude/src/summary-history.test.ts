import { createHash } from "node:crypto";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { ClaudeHistory } from "./history.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const message = (id: string, role: "user" | "assistant" = "assistant"): AgentItem => ({
  id,
  type: "message",
  role,
  text: `中文 ${id}`,
});
const tool = (id: string): AgentItem => ({
  id,
  type: "tool",
  name: "Read",
  status: "completed",
  output: "过程",
});
const turn = (id: string, items: AgentItem[]): AgentTurn => ({
  id,
  items,
  status: "completed",
  startedAt: null,
  completedAt: null,
  error: null,
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "claude-summary-"));
  roots.push(root);
  return new ClaudeHistory(root);
}

it("keeps live steering messages in a completed turn summary after restart", async () => {
  const history = await setup();
  const items = [
    message("question", "user"),
    tool("read"),
    message("steer-a", "user"),
    message("steer-b", "user"),
    message("answer"),
  ];
  await history.complete("task", turn("steered", items));
  expect((await new ClaudeHistory(history.directory).readSummary("task")).turns[0]?.items).toEqual([
    items[0],
    items[2],
    items[3],
    items[4],
  ]);
});

it("paginates whole turn summaries with stable task-bound cursors across restarts and arrivals", async () => {
  const history = await setup();
  for (let i = 0; i < 25; i++)
    await history.complete(
      "task",
      turn(`turn-${String(i)}`, [
        message(`q-${String(i)}`, "user"),
        tool(`tool-${String(i)}`),
        message(`a-${String(i)}`),
      ]),
    );
  const first = await new ClaudeHistory(history.directory).readSummary("task");
  expect(first.turns.map((value) => value.id)).toEqual(
    Array.from({ length: 20 }, (_, i) => `turn-${String(i + 5)}`),
  );
  expect(first.turns.every((value) => value.items.length === 2)).toBe(true);
  expect(first.cursor).toMatch(/^claude-turns:/u);
  await history.complete("task", turn("arrival", [message("new")]));
  const older = await new ClaudeHistory(history.directory).readSummary(
    "task",
    first.cursor ?? undefined,
  );
  expect(older.turns.map((value) => value.id)).toEqual(
    Array.from({ length: 5 }, (_, i) => `turn-${String(i)}`),
  );
  expect(older.cursor).toBeNull();
  await expect(history.readSummary("other", first.cursor ?? undefined)).rejects.toThrow(
    "Invalid Claude summary cursor",
  );
  await expect(history.readSummary("task", "100")).rejects.toThrow("Invalid Claude summary cursor");
});

it("migrates legacy snapshots, late updates and active checkpoints without inventing missing content", async () => {
  const history = await setup();
  const path = join(history.directory, hash("task"));
  const older = turn("old", [message("question", "user"), tool("process"), message("answer")]);
  const updated = {
    ...older,
    items: [message("question", "user"), tool("process"), message("new-answer")],
  };
  const unfinished = {
    ...turn("active", [message("active-question", "user"), tool("pending")]),
    status: "running" as const,
  };
  await writeFile(`${path}.jsonl`, JSON.stringify(older) + "\n");
  await writeFile(`${path}.${hash(older.id)}.turn`, JSON.stringify(updated));
  await writeFile(`${path}.active`, JSON.stringify(unfinished));
  const restored = new ClaudeHistory(history.directory);
  expect((await restored.readSummary("task")).turns).toEqual([
    { ...updated, items: [updated.items[0], updated.items[2]] },
  ]);
  expect(await restored.activeSummary("task")).toEqual({
    ...unfinished,
    items: [unfinished.items[0]],
  });
  expect(await new ClaudeHistory(history.directory).activeSummary("task")).toEqual({
    ...unfinished,
    items: [unfinished.items[0]],
  });
});

it("rebuilds summary references from persisted items when the old preview no longer contains the question", async () => {
  const history = await setup();
  const items = [
    message("question", "user"),
    ...Array.from({ length: 120 }, (_, i) => tool(`tool-${String(i)}`)),
    message("answer"),
  ];
  await history.saveItems("task", "long", items);
  await history.complete("task", turn("long", items.slice(-5)));
  await rm(join(history.directory, `${hash("task")}.summary-index`));
  await rm(join(history.items.directory, hash("task"), hash("long"), "summary"));
  const restored = new ClaudeHistory(history.directory);
  expect((await restored.readSummary("task")).turns[0]?.items).toEqual([items[0], items.at(-1)]);
});

it("keeps commentary in the process when no final answer exists", async () => {
  const history = await setup();
  const items = [message("question", "user"), message("commentary"), tool("last-tool")];
  await history.complete("task", turn("without-answer", items));
  expect((await history.readSummary("task")).turns[0]?.items).toEqual([items[0]]);
  // 更新较早正文不能改变首次出现顺序，也不能将它提升为最终答复。
  await history.saveItems("task", "without-answer", [message("commentary")]);
  expect((await history.readSummary("task")).turns[0]?.items).toEqual([items[0]]);
});

it.each(["running", "failed", "interrupted"] as const)(
  "does not promote unfinished assistant text in a %s turn",
  async (status) => {
    const history = await setup();
    const value = {
      ...turn("unfinished", [message("question", "user"), message("partial")]),
      status,
    };
    if (status === "running") {
      await history.checkpoint("task", value);
      const recovered = { ...value, status: "failed" as const };
      await history.recoverTurnMetadata("task", recovered);
      expect((await new ClaudeHistory(history.directory).activeSummary("task"))?.items).toEqual([
        value.items[0],
      ]);
    } else {
      await history.complete("task", value);
      expect(
        (await new ClaudeHistory(history.directory).readSummary("task")).turns[0]?.items,
      ).toEqual([value.items[0]]);
    }
  },
);

it("updates late summaries in place and repairs interrupted index construction without duplicates", async () => {
  const history = await setup();
  const initial = turn("original", [message("question", "user"), tool("process")]);
  await history.complete("task", initial);
  await history.complete("task", turn("next", []));
  await history.update("task", { ...initial, items: [message("late-answer")] });
  const path = join(history.directory, `${hash("task")}.summary-index`);
  await appendFile(path, "partial");
  const restored = new ClaudeHistory(history.directory);
  const page = await restored.readSummary("task");
  expect(page.turns.map((value) => value.id)).toEqual(["original", "next"]);
  expect(page.turns[0]?.items).toEqual([initial.items[0], message("late-answer")]);
  expect((await new ClaudeHistory(history.directory).readSummary("task")).turns).toEqual(
    page.turns,
  );
});

it("keeps large answers within the summary page budget without splitting a turn", async () => {
  const history = await setup();
  const large = (id: string): AgentItem => ({
    ...message(id),
    type: "message",
    role: "assistant",
    text: "x".repeat(120 * 1024),
  });
  for (let i = 0; i < 4; i++)
    await history.complete(
      "task",
      turn(String(i), [message(`q-${String(i)}`, "user"), large(`a-${String(i)}`)]),
    );
  const first = await history.readSummary("task");
  expect(first.turns.map((value) => value.id)).toEqual(["2", "3"]);
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(352 * 1024);
  const second = await history.readSummary("task", first.cursor ?? undefined);
  expect(second.turns.map((value) => value.id)).toEqual(["0", "1"]);
  expect(second.cursor).toBeNull();
});
