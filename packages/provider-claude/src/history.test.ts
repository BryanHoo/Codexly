import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { AgentTurn } from "@codexly/protocol";
import { ClaudeHistory } from "./history.js";

it("paginates newest turns backwards without losing order or duplicating checkpoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-history-"));
  try {
    const history = new ClaudeHistory(root);
    for (let i = 0; i < 25; i++) {
      const turn: AgentTurn = {
        id: `turn-${String(i)}`,
        status: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:01Z",
        error: null,
        items: [{ id: `message-${String(i)}`, type: "message", role: "assistant", text: "中文" }],
      };
      await history.checkpoint("task", { ...turn, status: "running" });
      await history.complete("task", turn);
    }
    const page = await new ClaudeHistory(root).read("task");
    expect(page.turns.map((turn) => turn.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `turn-${String(i + 5)}`),
    );
    const older = await history.read("task", page.cursor ?? undefined);
    expect(older.turns.map((turn) => turn.id)).toEqual(
      Array.from({ length: 5 }, (_, i) => `turn-${String(i)}`),
    );
    expect(older.cursor).toBeNull();
    expect(await history.active("task")).toBeUndefined();
    await expect(history.read("task", "-1")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("updates late background output without appending duplicate turns or losing pagination", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-history-update-"));
  try {
    const history = new ClaudeHistory(root);
    const turn: AgentTurn = {
      id: "original",
      status: "completed",
      startedAt: null,
      completedAt: null,
      error: null,
      items: [],
    };
    await history.complete("task", turn);
    await history.complete("task", { ...turn, id: "next" });
    await history.update("task", {
      ...turn,
      items: [{ id: "late", type: "message", role: "assistant", text: "late proof" }],
    });
    const page = await new ClaudeHistory(root).read("task");
    expect(page.turns.map((entry) => entry.id)).toEqual(["original", "next"]);
    expect(page.turns[0]?.items[0]).toMatchObject({ text: "late proof" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
