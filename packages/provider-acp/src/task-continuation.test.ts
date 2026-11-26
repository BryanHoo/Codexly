import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fixture, input } from "./provider.test-support.js";
import type { AgentTurn } from "@codexly/protocol";
import { withTaskContinuationFile } from "./task-continuation-file.js";
import { formatTaskContinuation, validateTaskContinuation } from "./task-continuation.js";

const turn = (id: string, role: "user" | "assistant", text: string): AgentTurn => ({
  id,
  status: "completed",
  error: null,
  startedAt: null,
  completedAt: null,
  items: [{ id, type: "message", role, text }],
});

describe("ACP 任务接续", () => {
  it("保留原始需求和近期回合，标注省略且限制 UTF-8 大小", () => {
    const first = turn("first", "user", "实现导出功能");
    const older = turn("older", "assistant", "旧输出".repeat(20_000));
    const latest = turn("latest", "assistant", "已完成导出，还需要补测试");
    const text = formatTaskContinuation("导出", [older, latest], first, true, 1024);
    expect(text).toContain("实现导出功能");
    expect(text).toContain("已完成导出，还需要补测试");
    expect(text).toContain("省略");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1024);
  });

  it("只允许同项目、同工作目录、不同 Agent 且来源已结束的任务接续", () => {
    const source = { id: "source", provider: "codex", projectId: "p", cwd: "/p", status: "idle" };
    const target = { ...source, id: "target", provider: "claude" };
    expect(() => {
      validateTaskContinuation(source, target);
    }).not.toThrow();
    for (const change of [
      { projectId: "other" },
      { cwd: "/other" },
      { provider: "claude" },
      { status: "active" },
    ]) {
      expect(() => {
        validateTaskContinuation({ ...source, ...change }, target);
      }).toThrow();
    }
  });
});

it("将来源历史附在新会话首轮，保留独立记录并可重新读取附件", async () => {
  const prompt = vi.fn();
  const { provider, tasks, history, restart, loaded } = await fixture(
    "claude",
    async ({ params }) => {
      prompt(params.prompt);
      return Promise.resolve({ stopReason: "end_turn" });
    },
  );
  const target = await provider.startTask();
  const targetRecord = tasks.get(target.id);
  if (!targetRecord) throw new Error("未创建目标任务");
  const source = { ...targetRecord, id: "source", provider: "codex", title: "导出" };
  tasks.set(source.id, source);
  await history.append(source.id, turn("old-turn", "user", "实现导出功能"));
  const submitted = await provider.startConfiguredTurn(
    target.id,
    {
      ...input,
      text: "继续补测试",
      continuationSourceTaskId: source.id,
    },
    {},
  );
  await vi.waitFor(() => {
    expect(prompt).toHaveBeenCalledTimes(1);
  });
  const received: unknown = prompt.mock.calls[0]?.[0];
  expect(received).toMatchObject([{ type: "text", text: "继续补测试" }, { type: "text" }]);
  expect(JSON.stringify(received)).toContain("实现导出功能");
  await vi.waitFor(async () => {
    expect(await history.hasTurns(target.id)).toBe(true);
  });
  const host = await restart();
  const snapshot = await host.readTask(target.id);
  const message = snapshot.turns
    .find(({ id }) => id === submitted.id)
    ?.items.find((item) => item.type === "message");
  expect(message).toMatchObject({ text: "继续补测试" });
  const attachment = message?.type === "message" ? message.attachments?.[0] : undefined;
  expect(attachment).toMatchObject({ name: "接续记录.md", continuationSourceTaskId: "source" });
  if (!attachment) throw new Error("未保存接续附件");
  const saved = await host.readTaskAttachment(target.id, attachment.id);
  expect(saved && Buffer.from(saved.content).toString()).toContain("实现导出功能");
  expect((await history.read(source.id)).turns.map(({ id }) => id)).toEqual(["old-turn"]);
  expect(loaded).not.toHaveBeenCalled();
});

it("将早期、中间和最近的多页历史作为可读文件发送，并保留回答续文", async () => {
  const received = vi.fn();
  const { provider, tasks, history, restart } = await fixture("claude", ({ params }) => {
    received(params.prompt);
    return Promise.resolve({ stopReason: "end_turn" });
  });
  const target = await provider.startTask();
  const record = tasks.get(target.id);
  if (!record) throw new Error("未创建目标任务");
  const source = { ...record, id: "wide-source", provider: "codex" };
  tasks.set(source.id, source);
  await history.append(source.id, turn("first", "user", "最初约定"));
  const [overflow] = await history.cache.content(source.id).prepare(source.id, {
    ...input,
    textAttachments: [{ name: "回答续文-1.txt", text: "另外保存的回答续文" }],
  });
  if (!overflow) throw new Error("未保存回答续文");
  for (let index = 0; index < 22; index++) {
    const text = `中段 ${String(index)}：` + "历史正文内容".repeat(600);
    await history.append(source.id, {
      ...turn(`extra-${String(index)}`, "assistant", text),
      items: [
        {
          id: `msg-${String(index)}`,
          type: "message",
          role: "assistant",
          text,
          ...(index === 5 ? { attachments: [overflow] } : {}),
        },
      ],
    });
  }
  await history.append(source.id, turn("latest", "assistant", "最后的待办"));
  const submitted = await provider.startConfiguredTurn(
    target.id,
    {
      ...input,
      text: "继续处理",
      continuationSourceTaskId: source.id,
    },
    {},
  );
  await vi.waitFor(() => {
    expect(received).toHaveBeenCalledTimes(1);
  });
  const blocks: unknown = received.mock.calls[0]?.[0];
  expect(blocks).toMatchObject([
    { type: "text", text: "继续处理" },
    { type: "text" },
    { type: "resource_link", name: "接续记录.md", mimeType: "text/markdown" },
  ]);
  const link = (blocks as { uri?: string }[])[2]?.uri;
  if (!link) throw new Error("未发送历史文件链接");
  const streamed = await readFile(fileURLToPath(link), "utf8");
  expect(streamed).toContain("最初约定");
  expect(streamed).toContain("中段 0");
  expect(streamed).toContain("另外保存的回答续文");
  expect(streamed).toContain("最后的待办");
  expect(Buffer.byteLength(streamed)).toBeGreaterThan(16 * 1024);
  expect(
    (await readdir(history.directory)).filter((name) => name.startsWith("acp-continuation-")),
  ).toEqual([]);
  await vi.waitFor(async () => {
    expect(await history.hasTurns(target.id)).toBe(true);
  });
  const host = await restart();
  const message = (await host.readTask(target.id)).turns
    .find(({ id }) => id === submitted.id)
    ?.items.find((item) => item.type === "message");
  const file =
    message?.type === "message"
      ? message.attachments?.find((item) => item.name === "接续记录.md")
      : undefined;
  if (!file) throw new Error("未保存接续文件");
  expect(file).toMatchObject({ kind: "file", continuationSourceTaskId: source.id });
  const saved = await host.readTaskAttachment(target.id, file.id);
  expect(saved && Buffer.from(saved.content).toString()).toBe(streamed);
});

it("超出文件额度时在文件内标注，并在准备失败后回收临时文件", async () => {
  const { provider, tasks, history } = await fixture("codex");
  const metadata = await provider.startTask();
  const source = tasks.get(metadata.id);
  if (!source) throw new Error("未创建来源任务");
  await history.append(source.id, turn("first", "user", "约定"));
  await history.append(source.id, turn("second", "assistant", "长正文".repeat(1024)));
  await expect(
    withTaskContinuationFile(history, source, 1024, async (path) => {
      const text = await readFile(path, "utf8");
      expect(text).toContain("约定");
      expect(text).toContain("接续附件已达到文件容量上限");
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1024);
      throw new Error("发送准备失败");
    }),
  ).rejects.toThrow("发送准备失败");
  expect(
    (await readdir(history.directory)).filter((name) => name.startsWith("acp-continuation-")),
  ).toEqual([]);
});
