import { expect, it, vi } from "vitest";
import { RequestError } from "@agentclientprotocol/sdk/experimental/v2/unstable";
import { readAcpTaskSnapshot } from "./task-snapshot.js";
import type { LocalTask } from "@codexly/core";
import type { AgentTurn } from "@codexly/protocol";
import { AcpHistoryCorruptionError, type AcpHistory } from "./history.js";

const task = {
  id: "task",
  provider: "codex",
  projectId: "project",
  sessionId: "native",
  cwd: "/tmp",
  title: "历史",
  updatedAt: 1,
  pinned: false,
} as LocalTask;
const turn: AgentTurn = {
  id: "old",
  items: [{ id: "answer", type: "message", role: "assistant", text: "真实历史" }],
  status: "completed",
  error: null,
  startedAt: null,
  completedAt: null,
};
function fixture() {
  const failure = new RequestError(-32600, "busy", {
    reason: "thread_active_writer",
    threadId: "native",
  });
  const read = vi.fn<AcpHistory["read"]>(() => Promise.resolve({ turns: [], cursor: null }));
  const source = {
    engine: "codex" as const,
    history: { read } as unknown as AcpHistory,
    load: vi.fn<(repairHistory?: boolean) => Promise<void>>(() => Promise.reject(failure)),
    active: () => undefined,
    pending: () => [],
    contextUsage: () => null,
    sessionState: () => undefined,
  };
  return { source, failure, read };
}
it("ACP 确认外部占用后保留已提交的历史与分页游标", async () => {
  const f = fixture();
  f.read.mockResolvedValue({ turns: [turn], cursor: "older" });
  const snapshot = await readAcpTaskSnapshot(task, { checkWriteAccess: true }, f.source);
  expect(snapshot).toMatchObject({
    writeAccess: "external",
    turns: [turn],
    turnsNextCursor: "older",
  });
  expect(f.source.load).toHaveBeenCalledExactlyOnceWith(false);
  expect(f.read).toHaveBeenCalledOnce();
});

it("从未同步的会话在外部占用时仍返回准确的写入状态", async () => {
  const f = fixture();
  await expect(readAcpTaskSnapshot(task, {}, f.source)).resolves.toMatchObject({
    writeAccess: "external",
    turns: [],
    turnsNextCursor: null,
  });
});

it("继续读取已提交的历史分页时复用 ACP 游标", async () => {
  const f = fixture();
  await readAcpTaskSnapshot(task, { cursor: "older" }, f.source);
  expect(f.source.load).not.toHaveBeenCalled();
  expect(f.read).toHaveBeenCalledExactlyOnceWith(task.id, "older");
});

it("外部占用期间保留待修复历史的已有页，解除占用后重新回放", async () => {
  const f = fixture();
  const source = { ...f.source, needsReplay: () => Promise.resolve(true) };
  f.read.mockResolvedValue({ turns: [turn], cursor: "older" });
  await expect(
    readAcpTaskSnapshot(task, { checkWriteAccess: true }, source),
  ).resolves.toMatchObject({
    writeAccess: "external",
    turns: [turn],
  });
  const recovered = { ...turn, id: "replayed" };
  f.source.load.mockImplementation(() => {
    f.read.mockResolvedValue({ turns: [recovered], cursor: null });
    return Promise.resolve();
  });
  await expect(
    readAcpTaskSnapshot(task, { checkWriteAccess: true }, source),
  ).resolves.toMatchObject({
    writeAccess: "writable",
    turns: [recovered],
  });
  expect(f.source.load.mock.calls).toEqual([[true], [true]]);
});

it("占用导致损坏的历史暂时无法回放时报告原始读取错误", async () => {
  const f = fixture();
  const corruption = new AcpHistoryCorruptionError("损坏");
  f.read.mockRejectedValue(corruption);
  await expect(readAcpTaskSnapshot(task, {}, f.source)).rejects.toBe(corruption);
});
it("其他会话的占用错误不能被吞掉", async () => {
  const f = fixture();
  await expect(readAcpTaskSnapshot({ ...task, sessionId: "other" }, {}, f.source)).rejects.toBe(
    f.failure,
  );
});

it("Claude 已有缓存时不因 Codex 写入权检查启动 Agent", async () => {
  const f = fixture();
  f.read.mockResolvedValue({ turns: [turn], cursor: null });
  const snapshot = await readAcpTaskSnapshot(
    { ...task, provider: "claude" },
    { checkWriteAccess: true },
    { ...f.source, engine: "claude" },
  );
  expect(snapshot.turns).toEqual([turn]);
  expect(f.source.load).not.toHaveBeenCalled();
});
