import { describe, expect, it, vi } from "vitest";
import {
  projectTasksInfiniteQueryOptions,
  taskQueueQueryKey,
  taskSnapshotQueryOptions,
} from "./task-queries.js";

describe("shared task queries", () => {
  it("passes cursor and cancellation to an injected page reader", async () => {
    const read = vi.fn().mockResolvedValue({ data: [], nextCursor: "next" });
    const options = projectTasksInfiniteQueryOptions<{ data: never[]; nextCursor: string | null }>(
      "p",
      read,
    );
    const signal = new AbortController().signal;
    await options.queryFn({ pageParam: "cursor", signal });
    expect(read).toHaveBeenCalledWith("cursor", signal);
    expect(
      options.getNextPageParam({ data: [], nextCursor: "cursor" }, [], "cursor"),
    ).toBeUndefined();
    expect(options.queryKey).toEqual(["projects", "p", "tasks"]);
  });

  it("keeps snapshot retention and queue keys stable", () => {
    const options = taskSnapshotQueryOptions("p", "t", vi.fn());
    expect(options.gcTime).toBe(30_000);
    expect(options.queryKey).toEqual(["projects", "p", "tasks", "t"]);
    expect(taskQueueQueryKey("p", "t")).toEqual(["projects", "p", "tasks", "t", "queue"]);
  });
});
