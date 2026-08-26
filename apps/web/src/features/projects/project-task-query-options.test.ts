import { describe, expect, it } from "vitest";

import { archivedProjectTasksQueryOptions } from "./project-task-query-options.js";

describe("archivedProjectTasksQueryOptions", () => {
  it("always refetches archived tasks when the dialog mounts", () => {
    const queryOptions = archivedProjectTasksQueryOptions("codexly", undefined, "");

    expect(queryOptions.refetchOnMount).toBe("always");
  });
});
