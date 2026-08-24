import { describe, expect, it } from "vitest";

import { createTaskStore } from "./task-store.js";
import { selectActiveTaskStore } from "./use-task-runtime.js";

describe("selectActiveTaskStore", () => {
  it("isolates retained normalized stores by project and task identity", () => {
    const store = createTaskStore({ projectId: "codexly", taskId: "task-1" });

    expect(selectActiveTaskStore(store, "other-project", "task-1")).toBeUndefined();
    expect(selectActiveTaskStore(store, "codexly", "task-other")).toBeUndefined();
    expect(selectActiveTaskStore(store, "codexly", "task-1")).toBe(store);
  });
});
