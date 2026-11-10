import { it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProvider, AgentProviderTurnInput } from "@codexly/core";
import { AcpQueue } from "./queue.js";
it("ACP 队列按应用身份持久化，未知提交重启后不重发", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-queue-"));
  try {
    const execute = vi.fn(() => Promise.reject(new Error("响应丢失")));
    const provider = {
      readTaskMetadata: () => Promise.resolve({ id: "t", engine: "codex" }),
      readTask: () => Promise.resolve({ turns: [] }),
      subscribeEvents: () => () => undefined,
    } as unknown as AgentProvider;
    const emit = vi.fn();
    const queue = new AcpQueue(root, execute, emit);
    const input = { text: "q", files: [], images: [], skills: [], textAttachments: [] };
    const added = await queue.add(provider, "p", "t", input, "message");
    expect(added.text).toBe("q");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "queue.changed", provider: "codex" }),
      "p",
    );
    await expect(queue.start(provider, "p", "t")).rejects.toThrow("响应丢失");
    const restarted = new AcpQueue(root, execute, () => undefined);
    expect((await restarted.list(provider, "p", "t"))[0]?.text).toBe("q");
    await expect(restarted.start(provider, "p", "t")).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("明确未提交后可以安全重试，执行不会读取旧厂商配置", async () => {
  const { AgentTurnNotSubmittedError } = await import("@codexly/core");
  const root = await mkdtemp(join(tmpdir(), "acp-queue-rejected-"));
  try {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new AgentTurnNotSubmittedError("busy"))
      .mockResolvedValue({
        id: "turn",
        status: "running",
        items: [],
        error: null,
        startedAt: null,
        completedAt: null,
      });
    const provider = {
      readTaskMetadata: () => Promise.resolve({ id: "t", engine: "codex" }),
      readTask: () => Promise.resolve({ turns: [] }),
    } as unknown as AgentProvider;
    const queue = new AcpQueue(root, execute, () => undefined);
    await queue.add(
      provider,
      "p",
      "t",
      { text: "q", files: [], images: [], skills: [], textAttachments: [] },
      "message",
    );
    await expect(queue.start(provider, "p", "t")).rejects.toThrow("busy");
    expect((await queue.start(provider, "p", "t")).id).toBe("turn");
    expect(execute).toHaveBeenCalledTimes(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("立即发送遇到回合切换时保留队列，不调用厂商 steer", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-queue-race-"));
  try {
    const execute = vi.fn(),
      steerTurn = vi.fn();
    const readTask = vi
      .fn()
      .mockResolvedValueOnce({ turns: [] })
      .mockResolvedValue({ turns: [{ id: "new", status: "running" }] });
    const provider = {
      readTaskMetadata: () => Promise.resolve({ id: "t", engine: "codex" }),
      readTask,
      steerTurn,
    } as unknown as AgentProvider;
    const queue = new AcpQueue(root, execute, () => undefined);
    await queue.add(
      provider,
      "p",
      "t",
      { text: "q", files: [], images: [], skills: [], textAttachments: [] },
      "message",
    );
    await expect(queue.start(provider, "p", "t")).rejects.toThrow();
    expect(steerTurn).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(await queue.list(provider, "p", "t")).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("重启后保留附件与编辑状态，排序和继续发送复用持久队列", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-queue-edit-"));
  try {
    const execute = vi.fn((_project: string, _task: string, _input: AgentProviderTurnInput) =>
      Promise.resolve({
        id: "turn",
        status: "running" as const,
        items: [],
        error: null,
        startedAt: null,
        completedAt: null,
      }),
    );
    let running = true;
    const provider = {
      readTaskMetadata: () => Promise.resolve({ id: "t", engine: "codex" }),
      readTask: () =>
        Promise.resolve({ turns: running ? [{ id: "active", status: "running" }] : [] }),
    } as unknown as AgentProvider;
    const input = {
      text: "one",
      files: [],
      images: [],
      skills: [],
      textAttachments: [{ name: "proof.txt", text: "正文" }],
    };
    const queue = new AcpQueue(root, execute, () => undefined);
    const first = await queue.add(provider, "p", "t", input, "first");
    const second = await queue.add(provider, "p", "t", { ...input, text: "two" }, "second");
    await queue.update(provider, "p", "t", first.id, { ...input, text: "edited" }, "editing");
    const restarted = new AcpQueue(root, execute, () => undefined);
    expect((await restarted.list(provider, "p", "t"))[0]).toMatchObject({
      text: "edited",
      status: "editing",
      attachments: [{ name: "proof.txt" }],
    });
    await restarted.reorder(provider, "p", "t", [second.id, first.id]);
    expect((await restarted.list(provider, "p", "t"))[0]?.id).toBe(second.id);
    await restarted.resume(provider, "p", "t");
    expect(execute).not.toHaveBeenCalled();
    running = false;
    await restarted.resume(provider, "p", "t");
    expect(execute.mock.calls[0]?.[2].textAttachments).toEqual([
      { name: "proof.txt", text: "正文" },
    ]);
    await restarted.resume(provider, "p", "t");
    expect(execute).toHaveBeenCalledTimes(1);
    await restarted.delete(provider, "p", "t", first.id);
    expect(await restarted.list(provider, "p", "t")).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
