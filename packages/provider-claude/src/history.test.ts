import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { AgentTurn } from "@codexly/protocol";
import { ClaudeHistory } from "./history.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, appendFile: vi.fn(actual.appendFile) };
});

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

it("serializes checkpoint recovery and keeps retries idempotent across history pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-history-recovery-"));
  try {
    const history = new ClaudeHistory(root);
    const turn: AgentTurn = {
      id: "crashed-turn",
      status: "running",
      startedAt: "2026-10-16T00:00:00Z",
      completedAt: null,
      error: null,
      items: [],
    };
    for (let i = 0; i < 25; i++)
      await history.complete("task", { ...turn, id: `older-${String(i)}`, status: "completed" });
    await history.checkpoint("task", turn);
    await Promise.all([history.archiveActive("task"), history.archiveActive("task")]);
    // 模拟归档成功后清理前退出，重新加载的实例仍应只保留一份失败回合。
    await history.checkpoint("task", turn);
    const restored = new ClaudeHistory(root);
    await restored.archiveActive("task");
    expect(await restored.active("task")).toBeUndefined();
    await restored.checkpoint("task", { ...turn, id: "next-turn" });
    await restored.complete("task", { ...turn, id: "next-turn", status: "completed" });

    const page = await restored.read("task");
    expect(page.turns.at(-2)).toEqual({
      ...turn,
      status: "failed",
      error: "Claude process ended before completing this turn",
    });
    const older = await restored.read("task", page.cursor ?? undefined);
    expect([...older.turns, ...page.turns].map((entry) => entry.id)).toEqual([
      ...Array.from({ length: 25 }, (_, i) => `older-${String(i)}`),
      turn.id,
      "next-turn",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves the checkpoint when archival fails and allows recovery after storage is repaired", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-history-recovery-error-"));
  try {
    const history = new ClaudeHistory(root);
    const turn: AgentTurn = {
      id: "crashed-turn",
      status: "running",
      startedAt: null,
      completedAt: null,
      error: null,
      items: [],
    };
    await history.checkpoint("task", turn);
    // 用同名目录制造真实存储故障，确保归档失败不会提前删除唯一检查点。
    const blocked = join(root, `${createHash("sha256").update("task").digest("hex")}.jsonl`);
    await mkdir(blocked);
    await expect(history.archiveActive("task")).rejects.toThrow();
    expect(await history.active("task")).toEqual(turn);
    await rm(blocked, { recursive: true });
    // 重新加载后仍能读取原始检查点，同一实例也可以安全重试归档。
    expect(await new ClaudeHistory(root).active("task")).toEqual(turn);
    await history.archiveActive("task");
    expect((await history.read("task")).turns).toEqual([
      { ...turn, status: "failed", error: "Claude process ended before completing this turn" },
    ]);
    expect(await history.active("task")).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not append a completed turn twice when checkpoint cleanup fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-history-cleanup-"));
  try {
    const history = new ClaudeHistory(root);
    const turn: AgentTurn = {
      id: "done",
      status: "completed",
      startedAt: null,
      completedAt: null,
      error: null,
      items: [],
    };
    // 模拟追加成功但检查点无法删除；恢复重试必须幂等。
    const active = join(root, `${createHash("sha256").update("task").digest("hex")}.active`);
    await mkdir(active);
    await expect(history.complete("task", turn)).rejects.toThrow();
    await rm(active, { recursive: true });
    await new ClaudeHistory(root).complete("task", turn);
    expect((await history.read("task")).turns).toEqual([turn]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rolls back a partially appended record after disk exhaustion so the terminal result can be retried", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-history-partial-"));
  const append = (await vi.importActual<typeof fs>("node:fs/promises")).appendFile;
  try {
    const history = new ClaudeHistory(root);
    const turn: AgentTurn = {
      id: "done",
      status: "completed",
      startedAt: null,
      completedAt: null,
      error: null,
      items: [],
    };
    await history.complete("task", { ...turn, id: "previous" });
    const failure = vi
      .spyOn(fs, "appendFile")
      .mockImplementationOnce(async (path, data, options) => {
        // ENOSPC 可以发生在部分字节已写入之后，不能留下破坏分页的半行 JSON。
        if (typeof data !== "string") throw new Error("Expected an encoded history record");
        await append(path, data.slice(0, 12), options);
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      });
    try {
      await expect(history.complete("task", turn)).rejects.toThrow("disk full");
    } finally {
      failure.mockRestore();
    }
    await history.complete("task", turn);
    expect((await new ClaudeHistory(root).read("task")).turns.map((entry) => entry.id)).toEqual([
      "previous",
      "done",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
