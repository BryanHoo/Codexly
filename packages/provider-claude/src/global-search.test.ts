import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ClaudeHistory } from "./history.js";
import { searchClaudeOccurrences } from "./global-search.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("paginates visible Claude matches with inclusive summary anchors and UTF-16 ranges", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-search-"));
  roots.push(root);
  const history = new ClaudeHistory(root);
  await history.complete("task", {
    id: "turn",
    status: "completed",
    startedAt: null,
    completedAt: null,
    error: null,
    items: [
      { id: "question", type: "message", role: "user", text: "😀 " + "关键词 ".repeat(35) },
      { id: "tool", type: "tool", name: "Read", status: "completed", output: "关键词" },
      { id: "commentary", type: "message", role: "assistant", phase: "commentary", text: "关键词" },
    ],
  });
  const first = await searchClaudeOccurrences(history, "task", { query: "关键词" });
  expect(first.data).toHaveLength(30);
  expect(first.nextCursor).not.toBeNull();
  if (first.nextCursor === null) throw new Error("Expected continuation cursor");
  await history.complete("task", {
    id: "arrival",
    status: "completed",
    startedAt: null,
    completedAt: null,
    error: null,
    items: [{ id: "new-question", type: "message", role: "user", text: "关键词" }],
  });
  const rest = await searchClaudeOccurrences(history, "task", {
    query: "关键词",
    cursor: first.nextCursor,
  });
  expect(rest.data).toHaveLength(5);
  expect(rest.nextCursor).toBeNull();
  for (const hit of [...first.data, ...rest.data]) {
    expect(hit.itemId).toBe("question");
    expect(hit.snippet.slice(hit.snippetMatchRange.start, hit.snippetMatchRange.end)).toBe(
      "关键词",
    );
    expect(
      (await history.readSummary("task", hit.turnCursor)).turns.some(
        (turn) => turn.id === hit.turnId,
      ),
    ).toBe(true);
  }
  await expect(
    searchClaudeOccurrences(history, "other", { query: "关键词", cursor: first.nextCursor }),
  ).rejects.toThrow(/cursor/i);
});
