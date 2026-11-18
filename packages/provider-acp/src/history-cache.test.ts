import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AcpHistory } from "./history.js";
import { AcpHistoryCache } from "./history-cache.js";
import { AcpHistoryUse } from "./history-use.js";
import type { AgentTurn } from "@codexly/protocol";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const turn: AgentTurn = {
  id: "turn",
  status: "completed",
  startedAt: null,
  completedAt: null,
  error: null,
  items: [{ id: "message", type: "message", role: "assistant", text: "正文".repeat(100) }],
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "acp-cache-"));
  roots.push(root);
  return { root, history: new AcpHistory(root), cache: new AcpHistoryCache(root, undefined, 900) };
}
it("按最近访问淘汰可重放正文，保留未知及不可重放历史和独有附件", async () => {
  const { root, history, cache } = await fixture();
  let time = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => time++);
  for (const task of ["old", "recent", "unknown", "resume-only"]) await history.append(task, turn);
  await cache.setReplayable("old", true);
  await cache.setReplayable("recent", true);
  await cache.setReplayable("resume-only", false);
  const attachments = join(root, "task-attachments");
  await mkdir(attachments);
  await writeFile(join(attachments, "original"), "唯一附件");
  await cache.prune();
  expect((await history.read("old")).turns).toEqual([]);
  expect((await history.read("recent")).turns).toHaveLength(1);
  expect((await history.read("unknown")).turns).toHaveLength(1);
  expect((await history.read("resume-only")).turns).toHaveLength(1);
  expect(await readFile(join(attachments, "original"), "utf8")).toBe("唯一附件");
});
it("跨实例占用保护活动历史，释放后将超大闲置缓存回收", async () => {
  const { root, history, cache } = await fixture();
  await history.append("task", turn);
  await cache.setReplayable("task", true);
  const release = await cache.acquire("task");
  const other = new AcpHistoryCache(root, undefined, 0);
  await other.prune();
  expect((await history.read("task")).turns).toHaveLength(1);
  await release();
  await other.prune();
  expect((await history.read("task")).turns).toEqual([]);
});
it("兼容能力在重启后保留，能力撤回后不再淘汰", async () => {
  const { root, history, cache } = await fixture();
  await history.append("task", turn);
  await cache.setReplayable("task", true);
  await cache.setReplayable("task", false);
  await new AcpHistoryCache(root, undefined, 0).prune();
  expect((await history.read("task")).turns).toHaveLength(1);
});
it("淘汰使旧游标明确失效，不影响目录中的非历史文件", async () => {
  const { root, history, cache } = await fixture();
  await history.replace(
    "task",
    Array.from({ length: 25 }, (_, i) => ({ ...turn, id: String(i) })),
  );
  const page = await history.read("task");
  const directory = join(root, createHash("sha256").update("task").digest("hex"));
  await writeFile(join(directory, "keep.json"), "保留");
  await cache.setReplayable("task", true);
  await new AcpHistoryCache(root, undefined, 0).prune();
  if (!page.cursor) throw new Error("缺少分页游标");
  await expect(history.read("task", page.cursor)).rejects.toThrow("失效");
  expect(await readdir(directory)).toContain("keep.json");
});

it("同一运行时的搜索和视图共享保护，最后一个使用者释放后才可回收", async () => {
  const { root, history, cache } = await fixture();
  await history.append("task", turn);
  await cache.setReplayable("task", true);
  const view = await cache.acquire("task");
  const search = await cache.acquire("task");
  await view();
  const other = new AcpHistoryCache(root, undefined, 0);
  await other.prune();
  expect(await history.hasTurns("task")).toBe(true);
  await search();
  await other.prune();
  expect(await history.hasTurns("task")).toBe(false);
});

it("并发关闭多个任务后统一回收，不因维护锁忙而遗留超额缓存", async () => {
  const { root } = await fixture();
  const history = new AcpHistory(root, undefined, 0);
  const usage = new AcpHistoryUse(history);
  for (const task of ["a", "b", "c"]) {
    await usage.retain(task);
    await history.append(task, turn);
    await history.cache.setReplayable(task, true);
  }
  await usage.close();
  for (const task of ["a", "b", "c"]) expect(await history.hasTurns(task)).toBe(false);
});

it("回答续文和工具详情计入缓存预算，回收不删除用户上传的原始附件", async () => {
  const { root, history, cache } = await fixture();
  await history.append("task", { ...turn, items: [] });
  await cache.setReplayable("task", true);
  const [attachment] = await cache.content("task").prepare("task", {
    text: "",
    images: [],
    files: [],
    skills: [],
    textAttachments: [{ name: "回答续文", text: "超长回答".repeat(1000) }],
  });
  if (!attachment) throw new Error("未生成续文");
  const originals = join(root, "task-attachments");
  await mkdir(originals);
  await writeFile(join(originals, "user-file"), "用户文件");
  expect(await cache.content("task").read("task", attachment.id)).toBeDefined();
  await cache.prune();
  expect(await history.hasTurns("task")).toBe(false);
  expect(await cache.content("task").read("task", attachment.id)).toBeUndefined();
  expect(await readFile(join(originals, "user-file"), "utf8")).toBe("用户文件");
});
