import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import type { LocalTask } from "@codexly/core";
import { startCodexAppServer } from "./app-server-process.js";
import { readCodexReadOnlyHistory } from "./read-only-history.js";

vi.mock("./app-server-process.js", () => ({ startCodexAppServer: vi.fn() }));
it("只读占用会话的历史并校验分页归属，结束后回收进程", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-readonly-"));
  const task = { id: "app-task", sessionId: "native", cwd: directory } as LocalTask;
  let turnPage = 0;
  const request = vi.fn((method: string) =>
    Promise.resolve(
      method === "thread/read"
        ? { thread: { id: "native", historyMode: "legacy" } }
        : {
            data: [
              {
                id: "turn",
                status: "completed",
                startedAt: null,
                completedAt: null,
                error: null,
                items: [
                  {
                    id: "answer",
                    type: "agentMessage",
                    questions: null,
                    delivery: null,
                    text: "外部应用的历史",
                    phase: "final_answer",
                  },
                ],
              },
            ],
            nextCursor: ++turnPage === 1 ? "next" : null,
          },
    ),
  );
  const close = vi.fn(() => Promise.resolve());
  const client = {
    request,
    notify: vi.fn(),
    onNotification: vi.fn(),
    onServerRequest: vi.fn(),
    rejectServerRequest: vi.fn(),
    respondToServerRequest: vi.fn(),
  };
  vi.mocked(startCodexAppServer).mockResolvedValue({ client, close } as unknown as Awaited<
    ReturnType<typeof startCodexAppServer>
  >);
  try {
    const attachments = new HistoricalTaskAttachments(directory);
    const page = await readCodexReadOnlyHistory(task, {}, attachments, {});
    expect(page.turns[0]?.items[0]).toMatchObject({ text: "外部应用的历史" });
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      "thread/read",
      "thread/turns/list",
    ]);
    expect(close).toHaveBeenCalledOnce();
    if (!page.cursor) throw new Error("缺少分页游标");
    await readCodexReadOnlyHistory(task, { cursor: page.cursor }, attachments, {});
    expect(request).toHaveBeenLastCalledWith(
      "thread/turns/list",
      expect.objectContaining({ cursor: "next", threadId: "native" }),
      undefined,
      undefined,
    );
    await expect(
      readCodexReadOnlyHistory({ ...task, id: "other" }, { cursor: page.cursor }, attachments, {}),
    ).rejects.toThrow("不属于当前任务");
    expect(startCodexAppServer).toHaveBeenCalledTimes(2);
    request.mockRejectedValueOnce(new Error("原生读取失败"));
    await expect(readCodexReadOnlyHistory(task, {}, attachments, {})).rejects.toThrow(
      "原生读取失败",
    );
    expect(close).toHaveBeenCalledTimes(3);
    const controller = new AbortController();
    controller.abort();
    await expect(
      readCodexReadOnlyHistory(task, { signal: controller.signal }, attachments, {}),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(startCodexAppServer).toHaveBeenCalledTimes(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
