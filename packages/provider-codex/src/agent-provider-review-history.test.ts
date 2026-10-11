import { describe, expect, it, vi } from "vitest";

import {
  FakeRpcClient,
  createCodexAgentProvider,
  nativeThread,
  project,
} from "./agent-provider.test-support.js";

const reviewTurn = (id: string) => ({
  completedAt: 1_753_232_400,
  error: null,
  id,
  items: [{ id: `${id}-review`, review: "current changes", type: "enteredReviewMode" }],
  startedAt: 1_753_228_800,
  status: "completed",
});

const workerTurn = (id: string) => ({
  completedAt: 1_753_232_400,
  error: null,
  id,
  items: [
    {
      content: [{ text: "Review the current code changes.", type: "text" }],
      id: `${id}-prompt`,
      type: "userMessage",
    },
    {
      aggregatedOutput: id,
      command: "git diff",
      cwd: "/workspace/Codexly",
      exitCode: 0,
      id: `${id}-command`,
      status: "completed",
      type: "commandExecution",
    },
  ],
  startedAt: 1_753_228_800,
  status: "completed",
});

const workerThread = (id: string) =>
  nativeThread({
    id,
    parentThreadId: "task-1",
    source: { subAgent: "review" },
    turns: undefined,
  });

describe("CodexAgentProvider review history", () => {
  it("merges multiple older worker turns into one parent continuation", async () => {
    const worker = { ...workerThread("worker"), historyMode: "paginated" };
    const itemPage = (id: string) => ({
      data: [{ turnId: id, item: workerTurn(id).items[1] }],
      nextCursor: null,
      backwardsCursor: null,
    });
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ turns: undefined }) },
      { data: [reviewTurn("review")], nextCursor: null },
      { data: [worker], nextCursor: null },
      { data: [{ ...workerTurn("new"), items: [] }], nextCursor: "worker-older-turns" },
      itemPage("new"),
      { thread: nativeThread({ turns: undefined }) },
      { thread: worker },
      {
        data: [
          { ...workerTurn("middle"), items: [] },
          { ...workerTurn("old"), items: [] },
        ],
        nextCursor: null,
      },
      itemPage("middle"),
      itemPage("old"),
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const first = await provider.readTask("task-1");
    const cursor = first?.turnsNextCursor;
    if (cursor === null || cursor === undefined) throw new Error("Expected a worker cursor");
    const second = await provider.readTask("task-1", { cursor });
    expect(second?.turns).toHaveLength(1);
    expect(second?.turns[0]).toMatchObject({
      id: "review",
      items: [{ id: "old-command" }, { id: "middle-command" }],
    });
  });

  it("keeps a paginated review worker on its parent turn and continues its older items on demand", async () => {
    const worker = { ...workerThread("worker"), historyMode: "paginated" };
    const nativeWorkerTurn = { ...workerTurn("worker-turn"), items: [] };
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ turns: undefined }) },
      { data: [reviewTurn("review")], nextCursor: null },
      { data: [worker], nextCursor: null },
      { data: [nativeWorkerTurn], nextCursor: null },
      {
        data: [{ turnId: "worker-turn", item: workerTurn("worker-turn").items[1] }],
        nextCursor: "older-worker-items",
        backwardsCursor: null,
      },
      { thread: nativeThread({ turns: undefined }) },
      { thread: worker },
      {
        data: [
          {
            turnId: "worker-turn",
            item: { ...workerTurn("worker-turn").items[1], id: "older-command" },
          },
        ],
        nextCursor: null,
        backwardsCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const first = await provider.readTask("task-1");
    expect(first?.turns).toHaveLength(1);
    expect(first?.turns[0]).toMatchObject({
      id: "review",
      items: [{ type: "review" }, { id: "worker-turn-command" }],
    });
    expect(first?.turnsNextCursor).toEqual(expect.any(String));
    const cursor = first?.turnsNextCursor;
    if (cursor === null || cursor === undefined) throw new Error("Expected a review Item cursor");
    const second = await provider.readTask("task-1", { cursor });
    expect(second).toMatchObject({
      turns: [{ id: "review", items: [{ id: "older-command" }] }],
      turnsNextCursor: null,
    });
    expect(rpc.calls.filter((c) => c.method === "thread/items/list")).toHaveLength(2);
  });

  it("pages review workers with the task cursor and reads the selected workers concurrently", async () => {
    let resolveMiddleWorker: ((value: unknown) => void) | undefined;
    const middleWorkerPage = new Promise((resolve) => {
      resolveMiddleWorker = resolve;
    });
    const rpc = new FakeRpcClient([]);

    rpc.request = (method: string, rawParams?: unknown): Promise<unknown> => {
      const params = (rawParams ?? {}) as Record<string, unknown>;
      rpc.calls.push({ method, params: rawParams });

      if (method === "thread/read") {
        return Promise.resolve({
          thread: nativeThread({ id: params["threadId"], turns: undefined }),
        });
      }
      if (method === "thread/turns/list") {
        const threadId = params["threadId"];
        if (threadId === "task-1") {
          return Promise.resolve(
            params["cursor"] === "parent-older"
              ? {
                  backwardsCursor: "parent-newer",
                  data: [reviewTurn("review-old")],
                  nextCursor: null,
                }
              : {
                  backwardsCursor: null,
                  data: [reviewTurn("review-new"), reviewTurn("review-middle")],
                  nextCursor: "parent-older",
                },
          );
        }
        if (threadId === "worker-middle") {
          return middleWorkerPage;
        }
        if (typeof threadId === "string" && threadId.startsWith("worker-")) {
          return Promise.resolve({
            backwardsCursor: null,
            data: [workerTurn(`${threadId}-turn`)],
            nextCursor: null,
          });
        }
      }
      if (method === "thread/list") {
        if (params["sortDirection"] === "desc") {
          return Promise.resolve(
            params["cursor"] === "review-older"
              ? { data: [workerThread("worker-old")], nextCursor: null }
              : {
                  data: [workerThread("worker-new"), workerThread("worker-middle")],
                  nextCursor: "review-older",
                },
          );
        }
        return Promise.resolve(
          params["cursor"] === "review-page-2"
            ? {
                data: [workerThread("worker-middle"), workerThread("worker-new")],
                nextCursor: null,
              }
            : { data: [workerThread("worker-old")], nextCursor: "review-page-2" },
        );
      }
      if (method === "thread/goal/get") {
        return Promise.resolve({ goal: null });
      }
      throw new Error(`Unexpected RPC: ${method}`);
    };

    const provider = createCodexAgentProvider({ client: rpc, project });
    const newestPagePromise = provider.readTask("task-1");
    await vi.waitFor(() => {
      expect(
        rpc.calls.some(
          ({ method, params }) =>
            method === "thread/turns/list" &&
            (params as Record<string, unknown>)["threadId"] === "worker-middle",
        ),
      ).toBe(true);
    });
    const workerCallsBeforeResolution = rpc.calls.filter(
      ({ method, params }) =>
        method === "thread/turns/list" &&
        typeof (params as Record<string, unknown>)["threadId"] === "string" &&
        (params as Record<string, unknown>)["threadId"] !== "task-1",
    );
    resolveMiddleWorker?.({
      backwardsCursor: null,
      data: [workerTurn("worker-middle-turn")],
      nextCursor: null,
    });

    const newestPage = await newestPagePromise;
    const cursor = newestPage?.turnsNextCursor;
    if (cursor === null || cursor === undefined) {
      throw new Error("Expected a task turn cursor");
    }
    await provider.readTask("task-1", { cursor });

    expect(workerCallsBeforeResolution.map(({ params }) => params)).toEqual([
      expect.objectContaining({ threadId: "worker-middle" }),
      expect.objectContaining({ threadId: "worker-new" }),
    ]);
    expect(rpc.calls.filter(({ method }) => method === "thread/list")).toEqual([
      {
        method: "thread/list",
        params: {
          limit: 2,
          parentThreadId: "task-1",
          sortDirection: "desc",
          sortKey: "created_at",
          sourceKinds: ["subAgentReview"],
          useStateDbOnly: true,
        },
      },
      {
        method: "thread/list",
        params: {
          cursor: "review-older",
          limit: 1,
          parentThreadId: "task-1",
          sortDirection: "desc",
          sortKey: "created_at",
          sourceKinds: ["subAgentReview"],
          useStateDbOnly: true,
        },
      },
    ]);
    expect(
      rpc.calls.filter(
        ({ method, params }) =>
          method === "thread/read" && (params as Record<string, unknown>)["threadId"] !== "task-1",
      ),
    ).toEqual([]);
  });
});
