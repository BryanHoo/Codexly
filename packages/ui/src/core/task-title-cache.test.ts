import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { patchTaskTitleCaches } from "./task-title-cache.js";

it("updates all title projections including an existing fallback without fetching history", () => {
  const client = new QueryClient();
  const task = { id: "task", projectId: "p", title: "用户消息的临时标题" };
  const other = { ...task, projectId: "other" };
  const pages = { pages: [{ data: [task, other], nextCursor: "older" }], pageParams: [undefined] };
  const keys = [
    ["projects", "p", "tasks"],
    ["task-board", "completed", ["p"]],
  ];
  for (const key of keys) client.setQueryData(key, pages);
  for (const source of ["pinned", "search-source"])
    client.setQueryData(["projects", "p", "tasks", source], [task]);
  client.setQueryData(["projects", "p", "tasks", "task"], {
    snapshot: { ...task },
    checkpoint: { sequence: 1 },
  });
  patchTaskTitleCaches(client, "p", "task", "生成的标题");
  for (const key of keys)
    expect(client.getQueryData(key)).toMatchObject({
      pages: [{ data: [{ title: "生成的标题" }, other], nextCursor: "older" }],
    });
  for (const source of ["pinned", "search-source"])
    expect(client.getQueryData(["projects", "p", "tasks", source])).toEqual([
      { ...task, title: "生成的标题" },
    ]);
  expect(client.getQueryData(["projects", "p", "tasks", "task"])).toMatchObject({
    snapshot: task,
    checkpoint: { sequence: 1 },
  });
  client.clear();
});
