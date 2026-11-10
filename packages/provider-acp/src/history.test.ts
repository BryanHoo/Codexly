import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import type { AgentTurn } from "@codexly/protocol";
import { AcpHistory } from "./history.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "acp-history-"));
  roots.push(root);
  return new AcpHistory(root);
}
function turn(i: number): AgentTurn {
  return {
    id: String(i),
    status: "completed",
    startedAt: null,
    completedAt: null,
    error: null,
    items: [
      { id: `message-${String(i)}`, type: "message", role: "assistant", text: `中文 ${String(i)}` },
    ],
  };
}
function* turns(count: number) {
  for (let i = 0; i < count; i++) yield turn(i);
}
describe("ACP 历史分页", () => {
  it("重启后按时间顺序读取最新20回合并遍历全部历史", async () => {
    const h = await fixture();
    await h.replace("task", turns(63));
    const reader = new AcpHistory(h.directory);
    let page = await reader.read("task");
    expect(page.turns.map((t) => t.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 43)),
    );
    const ids = page.turns.map((t) => t.id);
    while (page.cursor) {
      page = await reader.read("task", page.cursor);
      ids.unshift(...page.turns.map((t) => t.id));
    }
    expect(ids).toEqual(Array.from({ length: 63 }, (_, i) => String(i)));
  });
  it("失败重放保留旧版本，且允许稍后重试", async () => {
    const h = await fixture();
    await h.replace("task", turns(1));
    function* broken() {
      yield turn(99);
      throw new Error("重放断线");
    }
    await expect(h.replace("task", broken())).rejects.toThrow("重放断线");
    expect((await h.read("task")).turns[0]?.id).toBe("0");
    await h.replace("task", turns(2));
    expect((await h.read("task")).turns).toHaveLength(2);
  });
  it("追加不改变既有分页版本，旧游标在重新重放后仍可读取", async () => {
    const h = await fixture();
    await h.replace("task", turns(25));
    const old = await h.read("task");
    await h.append("task", turn(25));
    expect((await h.read("task")).turns.at(-1)?.id).toBe("25");
    await h.replace("task", turns(1));
    expect((await h.read("task", old.cursor ?? undefined)).turns.map((t) => t.id)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
  });
  it("任务隔离，拒绝跨任务和无效字节游标", async () => {
    const h = await fixture();
    await h.replace("a", turns(21));
    const p = await h.read("a");
    await expect(h.read("b", p.cursor ?? undefined)).rejects.toThrow("游标");
    await expect(h.read("a", "../../secret")).rejects.toThrow("游标");
    expect(await h.read("missing")).toEqual({ turns: [], cursor: null });
  });
  it("同任务跨实例写入冲突显式失败，不覆盖在途重放", async () => {
    const h = await fixture();
    const gate = Promise.withResolvers<undefined>();
    const started = Promise.withResolvers<undefined>();
    async function* pending() {
      started.resolve(undefined);
      await gate.promise;
      yield turn(0);
    }
    const write = h.replace("task", pending());
    await started.promise;
    await expect(new AcpHistory(h.directory).replace("task", turns(1))).rejects.toThrow("写入");
    gate.resolve(undefined);
    await write;
  });
  it("超出单回合预算时拒绝，原记录保持可读", async () => {
    const h = await fixture();
    await h.replace("task", turns(1));
    const huge = { ...turn(1), error: "字".repeat(1024 * 1024) };
    await expect(h.append("task", huge)).rejects.toThrow("预算");
    expect((await h.read("task")).turns).toHaveLength(1);
  });
  it("终态提交重试保持幂等，拒绝同身份内容冲突", async () => {
    const h = await fixture();
    await h.append("task", turn(1));
    await h.append("task", turn(1));
    expect((await h.read("task")).turns).toHaveLength(1);
    await expect(h.append("task", { ...turn(1), error: "冲突" })).rejects.toThrow("冲突");
  });
  it("删除投影只清理目标任务，不影响其他任务", async () => {
    const h = await fixture();
    await h.replace("a", turns(2));
    await h.replace("b", turns(1));
    await h.deleteTask("a");
    expect((await h.read("a")).turns).toEqual([]);
    expect((await h.read("b")).turns).toHaveLength(1);
  });
});
