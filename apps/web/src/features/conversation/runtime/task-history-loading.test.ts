import type { AgentItem, AgentTaskSnapshotResponse, AgentTurn } from "@codexly/protocol";
import { loadTaskHistory } from "@codexly/frontend-core/task-history-page";
import { describe, expect, it, vi } from "vitest";

import { createTaskStore } from "./task-store.js";
import { createResponse, eventEnvelope } from "./task-store.test-support.js";

const message = (id: string, role: "assistant" | "user" = "assistant"): AgentItem => ({
  id,
  type: "message",
  role,
  text: id,
  ...(role === "assistant" ? { phase: "final_answer" as const } : {}),
});
const thought = (id: string): AgentItem => ({ id, type: "reasoning", content: id, summary: id });
const turn = (items: AgentItem[], id = "turn"): AgentTurn => ({
  id,
  items,
  status: "completed",
  completedAt: null,
  startedAt: null,
  error: null,
});
const page = (items: AgentItem[], cursor: string | null, id = "turn") =>
  createResponse({ turns: [turn(items, id)], turnsNextCursor: cursor });

function setup(responses: AgentTaskSnapshotResponse[]) {
  const store = createTaskStore(
    { projectId: "project-1", taskId: "task-1" },
    page([message("final")], "first"),
  );
  const readPage = vi.fn((_cursor: string) => {
    const response = responses.shift();
    if (response === undefined) return Promise.reject(new Error("Unexpected history request"));
    return Promise.resolve(response);
  });
  const load = (isCurrent = () => true) =>
    loadTaskHistory({
      getState: store.getState,
      isCurrent,
      readPage,
      prependPage: (response) => {
        store.getState().prependHistory(response);
      },
    });
  return { store, readPage, load };
}

describe("loading older chat history", () => {
  it("retains the deferred process entry when a restored running turn completes", () => {
    const terminal = turn([message("final")]);
    const initial = createResponse({
      turns: [{ ...terminal, status: "running", processCursor: "deferred-process" }],
    });
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, initial);
    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        type: "turn.completed",
        turnId: terminal.id,
        payload: { turn: terminal },
      },
    ]);
    expect(store.getState().turnsById[terminal.id]?.processCursor).toBe("deferred-process");
  });

  it("loads one conversation page and does not consume process cursors", async () => {
    const response = page(
      [message("question", "user"), message("answer")],
      "older-turns",
      "older-turn",
    );
    response.snapshot.turns = response.snapshot.turns.map((turn) => ({
      ...turn,
      processCursor: "independent-process",
    }));
    const { store, readPage, load } = setup([response]);
    await load();
    expect(readPage.mock.calls).toEqual([["first"]]);
    expect(store.getState().turnIds).toEqual(["older-turn", "turn"]);
    expect(store.getState().turnsNextCursor).toBe("older-turns");
    expect(store.getState().turnsById["older-turn"]?.processCursor).toBe("independent-process");
  });

  it("keeps process pages in a separate store without modifying history", () => {
    const { store } = setup([]);
    const processStore = createTaskStore({ projectId: "project-1", taskId: "task-1" });
    processStore.getState().prependHistory(page([thought("tool-process")], "more-process"));
    expect(store.getState().turnsNextCursor).toBe("first");
    expect(
      store
        .getState()
        .reconstructSnapshot()
        ?.turns[0]?.items.map((item) => item.id),
    ).toEqual(["final"]);
    expect(processStore.getState().turnsNextCursor).toBe("more-process");
  });

  it("finishes when the history cursor is exhausted", async () => {
    const { store, readPage, load } = setup([page([message("old")], null, "old-turn")]);
    await load();
    await load();
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(store.getState().turnsNextCursor).toBeNull();
  });

  it("keeps the history cursor on failure and retries the same page", async () => {
    const { store, readPage, load } = setup([]);
    await expect(load()).rejects.toThrow("Unexpected history request");
    expect(store.getState().turnsNextCursor).toBe("first");
    readPage.mockResolvedValueOnce(page([message("question", "user")], null, "old-turn"));
    await load();
    expect(readPage.mock.calls).toEqual([["first"], ["first"]]);
  });

  it("discards a late page after switching tasks", async () => {
    const { store, readPage, load } = setup([]);
    let current = true;
    readPage.mockImplementationOnce(() => {
      current = false;
      return Promise.resolve(page([message("stale")], "next", "old-turn"));
    });
    await load(() => current);
    expect(store.getState().turnsNextCursor).toBe("first");
    expect(readPage).toHaveBeenCalledTimes(1);
  });
});
