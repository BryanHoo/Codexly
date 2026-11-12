import { expect, it, vi } from "vitest";
import type { LocalCatalogStore, LocalTask } from "@codexly/core";
import { AcpTaskTitles } from "./task-titles.js";
import { AcpEventProjection } from "./event-projection.js";

const task: LocalTask = {
  id: "task",
  provider: "codex",
  projectId: null,
  title: "",
  cwd: "/workspace",
  sessionId: null,
  status: "idle",
  archived: false,
  pinned: false,
  updatedAt: 1,
};
const input = { text: "正文", files: [], images: [], skills: [], textAttachments: [] };
function fixture() {
  const catalog = vi.fn((operation: string, payload: unknown): Promise<unknown> =>
    Promise.resolve(
      operation === "acp.title.claim" ? true : (payload as { title: string | null }).title,
    ),
  );
  const hasTurns = vi.fn(() => Promise.resolve(false));
  const generate = vi.fn((_task: LocalTask, _text: string, _signal: AbortSignal) =>
    Promise.resolve("标题"),
  );
  const publish = vi.fn();
  const scheduler = new AcpTaskTitles(
    { catalog } as unknown as LocalCatalogStore,
    "codex",
    null,
    hasTurns,
    generate,
    publish,
  );
  const projection = (id = task.id) =>
    new AcpEventProjection(id, "turn", (event) => {
      scheduler.receive(event);
    });
  return { scheduler, catalog, hasTurns, generate, publish, projection };
}

it("已有历史、被其他宿主领取及用户消息不会启动模型", async () => {
  const f = fixture();
  f.hasTurns.mockResolvedValueOnce(true);
  await f.scheduler.prepare(task, input);
  f.projection().finish("end_turn");
  expect(f.catalog).not.toHaveBeenCalled();
  await f.scheduler.prepare(task, input);
  f.projection().userMessage("user", "正文", []);
  expect(f.catalog).not.toHaveBeenCalled();
  f.catalog.mockResolvedValueOnce(false);
  f.projection().finish("end_turn");
  await f.scheduler.settled();
  expect(f.generate).not.toHaveBeenCalled();
});

it("附件仅使用名称，正文按 Unicode 限量，成功空输出终态可触发，失败终态不触发", async () => {
  const f = fixture();
  await f.scheduler.prepare(task, {
    ...input,
    text: "",
    textAttachments: [{ name: "修复说明", text: "不应发送的附件正文" }],
  });
  f.projection().finish("end_turn");
  await f.scheduler.settled();
  expect(f.generate.mock.calls[0]?.[1]).toBe("修复说明");
  await f.scheduler.prepare({ ...task, id: "long" }, { ...input, text: "😀".repeat(2000) });
  f.projection("long").finish("end_turn");
  await f.scheduler.settled();
  expect(Array.from(f.generate.mock.calls[1]?.[1] ?? "")).toHaveLength(1024);
  await f.scheduler.prepare({ ...task, id: "failed" }, input);
  f.projection("failed").fail("离线");
  expect(f.generate).toHaveBeenCalledTimes(2);
});

it("关闭在领取响应前取消，不调用模型，并完成空结果以消耗领取", async () => {
  const f = fixture();
  const claim = Promise.withResolvers<boolean>();
  f.catalog.mockImplementationOnce(() => claim.promise);
  await f.scheduler.prepare(task, input);
  f.projection().finish("end_turn");
  f.scheduler.cancel();
  claim.resolve(true);
  await f.scheduler.settled();
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.catalog).toHaveBeenLastCalledWith(
    "acp.title.finish",
    expect.objectContaining({ title: null }),
  );
  expect(f.publish).not.toHaveBeenCalled();
});

it("后台生成失败只完成一次领取，不能重试或发布伪造名称", async () => {
  const f = fixture();
  f.generate.mockRejectedValueOnce(new Error("离线"));
  await f.scheduler.prepare(task, input);
  f.projection().finish("end_turn");
  await f.scheduler.settled();
  await f.scheduler.prepare(task, input);
  f.projection().finish("end_turn");
  expect(f.generate).toHaveBeenCalledOnce();
  expect(f.publish).not.toHaveBeenCalled();
});

it("历史指针读取失败只跳过自动标题，不阻止主聊天准备", async () => {
  const f = fixture();
  f.hasTurns.mockRejectedValueOnce(new Error("不可读"));
  await expect(f.scheduler.prepare(task, input)).resolves.toBeUndefined();
  f.projection().finish("end_turn");
  expect(f.catalog).not.toHaveBeenCalled();
});

it("待处理与在途数量有界，归档立即取消，关闭等待辅助作业回收", async () => {
  const f = fixture();
  const signals: AbortSignal[] = [];
  f.generate.mockImplementation(async (_task, _text, signal) => {
    signals.push(signal);
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
    });
    signal.throwIfAborted();
    return "不应采用";
  });
  for (let i = 0; i < 70; i++)
    await f.scheduler.prepare({ ...task, id: `task-${String(i)}` }, input);
  // 超过待处理容量的任务不领取；已接受的前两个作业占满辅助并发。
  f.projection("task-69").finish("end_turn");
  expect(f.catalog).not.toHaveBeenCalled();
  for (let i = 0; i < 64; i++) f.projection(`task-${String(i)}`).finish("end_turn");
  await vi.waitFor(() => {
    expect(signals).toHaveLength(2);
  });
  f.scheduler.receive({ type: "task.removed", taskId: "task-0", payload: { reason: "archived" } });
  expect(signals[0]?.aborted).toBe(true);
  f.scheduler.cancel();
  await f.scheduler.settled();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.publish).not.toHaveBeenCalled();
});
