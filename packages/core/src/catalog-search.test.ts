import { expect, it, vi } from "vitest";
import type { LocalTask } from "./local-catalog.js";
import { CatalogSearchService } from "./catalog-search.js";

const task = (id: string, provider: string): LocalTask => ({
  id,
  provider,
  projectId: null,
  title: "本地名称",
  cwd: "/tmp",
  sessionId: `native-${id}`,
  updatedAt: 1,
  pinned: true,
  archived: false,
  status: "idle",
});
const scope = [{ id: "temporary", kind: "temporary" as const }];
const input = { query: "名称", kind: "tasks" as const, archived: false };

it("searches both engines' local titles without opening either runtime", async () => {
  const catalog = vi.fn(() =>
    Promise.resolve({ data: [task("a", "claude"), task("b", "codex")], nextCursor: null }),
  );
  const occurrences = vi.fn();
  const search = new CatalogSearchService({ catalog }, occurrences);
  expect((await search.searchTasks(input, scope)).data.map((hit) => hit.task.engine)).toEqual([
    "claude",
    "codex",
  ]);
  expect(catalog).toHaveBeenCalledWith("task.list", {
    archived: false,
    limit: 30,
    searchTerm: "名称",
  });
  expect(occurrences).not.toHaveBeenCalled();
});

it("routes mixed history and continues past empty candidates to find older matches", async () => {
  let reads = 0;
  const catalog = vi.fn(() =>
    Promise.resolve(
      ++reads === 1
        ? { data: [task("a", "claude"), task("b", "codex")], nextCursor: "older" }
        : { data: [task("c", "claude")], nextCursor: "even-older" },
    ),
  );
  const occurrences = vi.fn((task: LocalTask) =>
    Promise.resolve({
      data:
        task.id === "c"
          ? [
              {
                itemId: "message",
                turnId: "turn",
                turnCursor: "inclusive",
                snippet: "名称",
                snippetMatchRange: { start: 0, end: 2 },
              },
            ]
          : [],
      nextCursor: null,
    }),
  );
  const search = new CatalogSearchService({ catalog }, occurrences);
  const page = await search.searchTasks({ ...input, kind: "history" }, scope);
  expect(page.data.map((hit) => hit.task.id)).toEqual(["c"]);
  expect(page.nextCursor).toBeTypeOf("string");
  if (page.nextCursor === null) throw new Error("Expected continuation cursor");
  expect(occurrences.mock.calls.map((call) => call[0].provider)).toEqual([
    "claude",
    "codex",
    "claude",
  ]);
  await expect(
    search.searchTasks(
      { ...input, kind: "history", query: "different", cursor: page.nextCursor },
      scope,
    ),
  ).rejects.toThrow(/cursor/i);
});

it("validates task ownership before occurrence dispatch and stops cancelled queries", async () => {
  const catalog = vi.fn(() => Promise.resolve(task("a", "claude")));
  const occurrences = vi.fn();
  const search = new CatalogSearchService({ catalog }, occurrences);
  await expect(
    search.searchTaskOccurrences("a", { query: "名称" }, { id: "other", kind: "project" }),
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(search.searchTasks(input, scope, controller.signal)).rejects.toThrow();
  expect(occurrences).not.toHaveBeenCalled();
});

it("keeps healthy engine results and reports a failing engine without treating cancellation as failure", async () => {
  const catalog = vi.fn(() =>
    Promise.resolve({ data: [task("a", "codex"), task("b", "claude")], nextCursor: null }),
  );
  const hit = {
    itemId: "message",
    turnId: "turn",
    turnCursor: "inclusive",
    snippet: "名称",
    snippetMatchRange: { start: 0, end: 2 },
  };
  const search = new CatalogSearchService({ catalog }, (task) =>
    task.provider === "codex"
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ data: [hit], nextCursor: null }),
  );
  expect(await search.searchTasks({ ...input, kind: "history" }, scope)).toMatchObject({
    data: [{ task: { engine: "claude" }, occurrence: hit }],
    unavailableEngines: ["codex"],
  });
});
