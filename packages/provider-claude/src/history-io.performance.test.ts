import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { AgentTurn } from "@codexly/protocol";
import { ClaudeHistory } from "./history.js";

it("measures steady checkpoint I/O inside a traceable syscall window", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-checkpoint-measure-"));
  try {
    const history = new ClaudeHistory(root);
    const turn: AgentTurn = {
      id: "turn",
      status: "running",
      startedAt: null,
      completedAt: null,
      error: null,
      items: Array.from({ length: 512 }, (_, i) => ({
        id: `message-${String(i)}`,
        type: "message",
        role: "assistant",
        text: "x".repeat(200),
      })),
    };
    await history.checkpoint("task", turn);
    // Node FS trace 与 hrtime 使用同一单调时钟；仅圈定预写后的三次检查点，排除测试框架和清理 I/O。
    const startUs = Number(process.hrtime.bigint() / 1000n);
    const durations: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      await history.checkpoint("task", turn);
      durations.push(performance.now() - start);
    }
    const endUs = Number(process.hrtime.bigint() / 1000n);
    console.info(
      "claude-history-checkpoint",
      JSON.stringify({
        startUs,
        endUs,
        samples: durations.length,
        meanMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
        itemCount: turn.items.length,
        charactersPerItem: 200,
      }),
    );
    expect(durations).toHaveLength(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
