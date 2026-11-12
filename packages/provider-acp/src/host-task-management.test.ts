import { Writable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { LocalTask } from "@codexly/core";
import { AcpHost } from "./host.js";
import { AcpHistory } from "./history.js";
import type { AcpAgentLauncher } from "./runtime.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "acp-management-"));
  const tasks = new Map<string, LocalTask>();
  const frames: Record<string, unknown>[] = [];
  const launch = vi.fn<AcpAgentLauncher>(() => Promise.reject(new Error("agent 不可用")));
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      const frame = JSON.parse(chunk.toString()) as Record<string, unknown>;
      if (typeof frame["catalogId"] === "number") {
        const op = frame["operation"],
          input = frame["payload"] as LocalTask;
        let result: unknown = null;
        if (op === "task.read") result = tasks.get(input.id) ?? null;
        else if (op === "task.put" || op === "task.patch") {
          const task = op === "task.put" ? input : { ...tasks.get(input.id), ...input };
          tasks.set(task.id, task);
          result = task;
        } else if (op === "task.remove") result = tasks.delete(input.id);
        queueMicrotask(() => {
          host.receive(
            Buffer.from(`${JSON.stringify({ catalogId: frame["catalogId"], result })}\n`),
          );
        });
      } else frames.push(frame);
      done();
    },
  });
  const host = new AcpHost(root, output, launch);
  const scope = { id: "p", kind: "project", rootPath: root, runtimeWorkspaceRoots: [root] };
  let next = 0;
  async function request(method: string, params: Record<string, unknown>, project = "p") {
    const id = ++next;
    host.receive(
      Buffer.from(`${JSON.stringify({ id, method, scope: { ...scope, id: project }, params })}\n`),
    );
    return vi.waitFor(() => {
      const frame = frames.find((f) => f["id"] === id);
      if (!frame) throw new Error("等待宿主响应");
      return frame;
    });
  }
  return {
    root,
    tasks,
    frames,
    launch,
    request,
    close: async () => {
      await host.close();
      output.destroy();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it.each(["codex", "claude"] as const)(
  "共享宿主管理 %s 元数据并发布真实引擎事件，不启动 agent",
  async (engine) => {
    const f = await fixture();
    try {
      const started = await f.request("task.start", { engine });
      const taskId = (started["result"] as { id: string }).id;
      const pin = await f.request("task.pin", { taskId, pinned: true });
      expect(pin).not.toHaveProperty("error");
      expect(pin["result"]).toMatchObject({ id: taskId, pinned: true, engine });
      expect(await f.request("task.rename", { taskId, title: "保留原始标题" })).not.toHaveProperty(
        "error",
      );
      expect(await f.request("task.archive", { taskId })).not.toHaveProperty("error");
      expect(f.tasks.get(taskId)?.archived).toBe(true);
      const restored = await f.request("task.unarchive", { taskId });
      expect(restored["result"]).toMatchObject({ id: taskId, title: "保留原始标题", engine });
      expect(f.tasks.get(taskId)?.archived).toBe(false);
      expect(await f.request("task.delete", { taskId })).not.toHaveProperty("error");
      expect(f.tasks.has(taskId)).toBe(false);
      const events = f.frames.flatMap((frame) => (frame["event"] ? [frame["event"]] : [])) as {
        type: string;
        provider: string;
        taskId: string;
      }[];
      expect(events.filter((event) => event.type === "task.metadata_changed")).toHaveLength(3);
      expect(events.filter((event) => event.type === "task.removed")).toHaveLength(2);
      expect(events.every((event) => event.provider === engine && event.taskId === taskId)).toBe(
        true,
      );
      expect(f.launch).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  },
);

it("管理参数拒绝越权、未知字段、错误类型和超长标题，拒绝不改目录", async () => {
  const f = await fixture();
  try {
    const started = await f.request("task.start", { engine: "claude" });
    const taskId = (started["result"] as { id: string }).id;
    const before = { ...f.tasks.get(taskId) };
    for (const [method, extra] of [
      ["task.pin", { pinned: "true" }],
      ["task.pin", { pinned: true, scope: { id: "other" } }],
      ["task.rename", { title: "   " }],
      ["task.rename", { title: "x".repeat(201) }],
      ["task.rename", { title: "标题", rootPath: "/secret" }],
      ["task.archive", { force: true }],
      ["task.unarchive", { archived: false }],
      ["task.delete", { force: true }],
    ] as const)
      expect(await f.request(method, { taskId, ...extra })).toHaveProperty("error");
    for (const method of [
      "task.pin",
      "task.rename",
      "task.archive",
      "task.unarchive",
      "task.delete",
    ]) {
      const extra =
        method === "task.pin"
          ? { pinned: true }
          : method === "task.rename"
            ? { title: "越权" }
            : {};
      expect(await f.request(method, { taskId, ...extra }, "other")).toHaveProperty("error");
    }
    expect(f.tasks.get(taskId)).toEqual(before);
    expect(f.launch).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("原生删除失败保留绑定、历史及订阅，不能只删除应用记录冒充成功", async () => {
  const f = await fixture();
  try {
    const started = await f.request("task.start", { engine: "claude" });
    const taskId = (started["result"] as { id: string }).id;
    const task = f.tasks.get(taskId);
    if (!task) throw new Error("未创建目录任务");
    f.tasks.set(taskId, { ...task, sessionId: "原生历史" });
    const history = new AcpHistory(join(f.root, "history"));
    await history.append(taskId, {
      id: "old",
      status: "completed",
      startedAt: null,
      completedAt: null,
      error: null,
      items: [{ id: "reply", type: "message", role: "assistant", text: "原始历史" }],
    });
    await f.request("task.retain", { taskId, leaseId: "view" });
    expect(await f.request("task.delete", { taskId })).toHaveProperty("error");
    expect(f.tasks.get(taskId)?.sessionId).toBe("原生历史");
    expect((await history.read(taskId)).turns[0]?.items[0]).toMatchObject({ text: "原始历史" });
    expect(
      f.frames.some(
        (frame) => (frame["event"] as { type?: string } | undefined)?.type === "task.removed",
      ),
    ).toBe(false);
    expect(await f.request("task.release", { taskId, leaseId: "view" })).not.toHaveProperty(
      "error",
    );
  } finally {
    await f.close();
  }
});
