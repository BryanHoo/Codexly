import { describe, expect, it } from "vitest";
import { FakeRpcClient } from "./agent-provider.test-support.js";
import { decodeTaskTurnCursor, readNativeTaskTurnPage } from "./task-history-pagination.js";

const turn = {
  id: "turn-a",
  status: "completed",
  startedAt: 1,
  completedAt: 2,
  error: null,
  items: [],
  itemsView: "notLoaded",
};
const entries = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    turnId: turn.id,
    startedAtMs: (start + i) * 1000,
    item: { id: `item-${String(start + i)}`, type: "agentMessage", text: "正文" },
  })).reverse();

describe("task item page boundary", () => {
  it("keeps legacy process reads lazy and scoped to the original turn page", async () => {
    const rpc = new FakeRpcClient([
      { data: [{ ...turn, itemsView: "summary" }], nextCursor: "older-turns" },
      {
        data: [
          { ...turn, itemsView: "full", items: [{ id: "tool", type: "plan", text: "内部过程" }] },
        ],
        nextCursor: "older-turns",
      },
    ]);
    const summary = await readNativeTaskTurnPage(rpc, "task-1", "legacy", "original-page", true);
    expect(rpc.calls).toHaveLength(1);
    const cursor = (summary.turns[0] as { processCursor: string }).processCursor;
    const process = await readNativeTaskTurnPage(
      rpc,
      "task-1",
      "legacy",
      decodeTaskTurnCursor({ cursor }).turnCursor,
    );
    expect(process.nextTurnCursor).toBeNull();
    expect(process.turns).toMatchObject([{ id: turn.id, items: [{ id: "tool" }] }]);
    expect(rpc.calls[1]?.params).toMatchObject({ itemsView: "full", cursor: "original-page" });
  });

  it("paginates conversation summaries without reading process items", async () => {
    const summary = {
      ...turn,
      itemsView: "summary",
      items: [
        { id: "question", type: "userMessage", content: [] },
        { id: "answer", type: "agentMessage", text: "答复" },
      ],
    };
    const rpc = new FakeRpcClient([{ data: [summary], nextCursor: "older-turns" }]);
    const page = await readNativeTaskTurnPage(rpc, "task-1", "paginated", undefined, true);
    expect(page.nextTurnCursor).toBe("older-turns");
    expect(page.turns).toMatchObject([{ items: summary.items }]);
    expect(typeof (page.turns[0] as { processCursor: unknown }).processCursor).toBe("string");
    expect(rpc.calls).toEqual([
      {
        method: "thread/turns/list",
        params: { threadId: "task-1", itemsView: "summary", limit: 10, sortDirection: "desc" },
      },
    ]);
  });

  it("reads only the expanded turn using its independent process cursor", async () => {
    const rpc = new FakeRpcClient([
      { data: [{ ...turn, itemsView: "summary" }], nextCursor: "older-turns" },
      { data: entries(100, 100), nextCursor: "older-items", backwardsCursor: null },
      { data: entries(0, 100), nextCursor: null, backwardsCursor: null },
    ]);
    const summary = await readNativeTaskTurnPage(rpc, "task-1", "paginated", undefined, true);
    const processCursor = (summary.turns[0] as { processCursor: string }).processCursor;
    const process = await readNativeTaskTurnPage(
      rpc,
      "task-1",
      "paginated",
      decodeTaskTurnCursor({ cursor: processCursor }).turnCursor,
    );
    expect(process.turns).toMatchObject([{ id: turn.id }]);
    const last = await readNativeTaskTurnPage(
      rpc,
      "task-1",
      "paginated",
      process.nextTurnCursor ?? undefined,
    );
    expect(last.nextTurnCursor).toBeNull();
    expect(rpc.calls.slice(1).map((call) => call.method)).toEqual([
      "thread/items/list",
      "thread/items/list",
    ]);
    expect(rpc.calls[1]?.params).toMatchObject({ turnId: turn.id });
  });

  it("rejects an item continuation from another task before issuing an RPC", async () => {
    const rpc = new FakeRpcClient([
      { data: [turn], nextCursor: null },
      { data: entries(100, 1), nextCursor: "older-items", backwardsCursor: null },
    ]);
    const first = await readNativeTaskTurnPage(rpc, "task-1", "paginated");
    await expect(
      readNativeTaskTurnPage(rpc, "other-task", "paginated", first.nextTurnCursor ?? undefined),
    ).rejects.toThrow("Task item continuation is invalid");
    expect(rpc.calls).toHaveLength(2);
  });

  it("resumes only unfinished turns and keeps the original turn order", async () => {
    const turns = [turn, { ...turn, id: "done" }, { ...turn, id: "old" }];
    const page = (id: string, cursor: string | null) => ({
      data: [{ turnId: id, item: { id: `${id}-item`, type: "agentMessage", text: "正文" } }],
      nextCursor: cursor,
      backwardsCursor: null,
    });
    const rpc = new FakeRpcClient([
      { data: turns, nextCursor: "older-turns" },
      page("turn-a", "a-next"),
      page("done", null),
      page("old", "old-next"),
      page("turn-a", null),
      page("old", null),
    ]);
    const first = await readNativeTaskTurnPage(rpc, "task-1", "paginated");
    const next = await readNativeTaskTurnPage(
      rpc,
      "task-1",
      "paginated",
      first.nextTurnCursor ?? undefined,
    );
    expect(next.turns.map((value) => (value as { id: string }).id)).toEqual(["old", "turn-a"]);
    expect(next.nextTurnCursor).toBe("older-turns");
    expect(rpc.calls.slice(4).map((call) => call.params)).toEqual([
      expect.objectContaining({ turnId: "turn-a", cursor: "a-next" }),
      expect.objectContaining({ turnId: "old", cursor: "old-next" }),
    ]);
  });

  it("returns one page before reading any of the remaining 9,900 items", async () => {
    const rpc = new FakeRpcClient([
      { data: [turn], nextCursor: "older-turns" },
      { data: entries(9900, 100), nextCursor: "older-items", backwardsCursor: "newer-items" },
    ]);
    const first = await readNativeTaskTurnPage(rpc, "task-1", "paginated");
    expect(first.turns).toMatchObject([
      {
        items: entries(9900, 100)
          .reverse()
          .map((e) => e.item),
      },
    ]);
    expect(first.nextTurnCursor).toEqual(expect.any(String));
    expect(rpc.calls.filter((c) => c.method === "thread/items/list")).toHaveLength(1);
  });

  it("continues only unfinished turns before advancing to the older turn page", async () => {
    const rpc = new FakeRpcClient([
      { data: [turn], nextCursor: "older-turns" },
      { data: entries(100, 100), nextCursor: "older-items", backwardsCursor: null },
      { data: entries(0, 100), nextCursor: null, backwardsCursor: null },
      { data: [], nextCursor: null },
    ]);
    const first = await readNativeTaskTurnPage(rpc, "task-1", "paginated");
    const second = await readNativeTaskTurnPage(
      rpc,
      "task-1",
      "paginated",
      first.nextTurnCursor ?? undefined,
    );
    expect(second.turns).toMatchObject([
      {
        id: turn.id,
        items: entries(0, 100)
          .reverse()
          .map((e) => e.item),
      },
    ]);
    expect(second.nextTurnCursor).toBe("older-turns");
    expect(rpc.calls[2]).toMatchObject({
      method: "thread/items/list",
      params: { cursor: "older-items", turnId: turn.id },
    });
    await readNativeTaskTurnPage(rpc, "task-1", "paginated", second.nextTurnCursor ?? undefined);
    expect(rpc.calls[3]).toMatchObject({
      method: "thread/turns/list",
      params: { cursor: "older-turns" },
    });
  });
});
