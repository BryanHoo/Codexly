import { expect, it, vi } from "vitest";
import { RequestError } from "@agentclientprotocol/sdk/unstable";
import { readAcpTaskSnapshot } from "./task-snapshot.js";
import type { LocalTask } from "@codexly/core";
import type { AgentTurn } from "@codexly/protocol";
import type { AcpHistory } from "./history.js";

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
  const read = vi.fn(() => Promise.resolve({ turns: [] as AgentTurn[], cursor: null }));
  const readOnlyHistory = vi.fn(() => Promise.resolve({ turns: [turn], cursor: "older" }));
  const source = {
    engine: "codex" as const,
    history: { read } as unknown as AcpHistory,
    load: vi.fn(() => Promise.reject(failure)),
    readOnlyHistory,
    active: () => undefined,
    pending: () => [],
    contextUsage: () => null,
    sessionState: () => undefined,
  };
  return { source, failure, read, readOnlyHistory };
}
it("ACP 占用错误保留真实历史并返回只读状态", async () => {
  const f = fixture();
  const snapshot = await readAcpTaskSnapshot(task, {}, f.source);
  expect(snapshot).toMatchObject({
    writeAccess: "external",
    turns: [turn],
    turnsNextCursor: "codex-readonly:older",
  });
  expect(f.readOnlyHistory).toHaveBeenCalledOnce();
});
it("首屏本地已有缓存时仍确认写入权", async () => {
  const f = fixture();
  f.read.mockResolvedValue({ turns: [turn], cursor: null });
  expect((await readAcpTaskSnapshot(task, { checkWriteAccess: true }, f.source)).writeAccess).toBe(
    "external",
  );
});
it("只读续页不加载 ACP 会话也不读取 ACP 缓存", async () => {
  const f = fixture();
  await readAcpTaskSnapshot(task, { cursor: "codex-readonly:older" }, f.source);
  expect(f.source.load).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});
it("其他会话的占用错误不能被吞掉", async () => {
  const f = fixture();
  await expect(readAcpTaskSnapshot({ ...task, sessionId: "other" }, {}, f.source)).rejects.toBe(
    f.failure,
  );
  expect(f.readOnlyHistory).not.toHaveBeenCalled();
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
