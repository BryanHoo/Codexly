import { describe, expect, it } from "vitest";

import { createComposerDraftStore } from "./composer-draft-context.js";
import {
  createComposerDraftBinding,
  shouldRestoreComposerBinding,
} from "./project-draft-binding.js";
import { createProjectDraftStore } from "./project-draft-store.js";

function createMemoryStorage(): Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("composer project draft binding", () => {
  it("restores when the draft scope changes without a route change", () => {
    expect(
      shouldRestoreComposerBinding(
        { routeScope: "project-a:task-a", storageScope: "task-a" },
        { routeScope: "project-a:task-a", storageScope: "draft-a" },
      ),
    ).toBe(true);
  });

  it("keeps the same working copy when taskId changes inside a project", () => {
    const storage = createMemoryStorage();
    const composerDrafts = createComposerDraftStore(storage);
    const projectDrafts = createProjectDraftStore(storage, { createId: () => "draft-a" });
    projectDrafts.create("project-a", {
      attachments: [],
      content: [{ text: "保存版本", type: "text" }],
    });
    const taskA = createComposerDraftBinding({
      composerDrafts,
      editingDraftId: "draft-a",
      projectDrafts,
      projectId: "project-a",
      taskId: "task-a",
    });
    const taskB = createComposerDraftBinding({
      composerDrafts,
      editingDraftId: "draft-a",
      projectDrafts,
      projectId: "project-a",
      taskId: "task-b",
    });

    taskA.update(() => ({
      attachments: [],
      content: [{ text: "未保存工作副本", type: "text" }],
    }));

    expect(taskA.scope).toBe(taskB.scope);
    expect(taskB.read().content).toEqual([{ text: "未保存工作副本", type: "text" }]);
    expect(projectDrafts.read("project-a", "draft-a")?.draft.content).toEqual([
      { text: "保存版本", type: "text" },
    ]);
  });

  it("keeps ordinary composer drafts task-scoped", () => {
    const storage = createMemoryStorage();
    const composerDrafts = createComposerDraftStore(storage);
    const projectDrafts = createProjectDraftStore(storage);
    const taskA = createComposerDraftBinding({
      composerDrafts,
      editingDraftId: undefined,
      projectDrafts,
      projectId: "project-a",
      taskId: "task-a",
    });
    const taskB = createComposerDraftBinding({
      composerDrafts,
      editingDraftId: undefined,
      projectDrafts,
      projectId: "project-a",
      taskId: "task-b",
    });

    taskA.update(() => ({
      attachments: [],
      content: [{ text: "任务 A 输入", type: "text" }],
    }));

    expect(taskA.scope).not.toBe(taskB.scope);
    expect(taskB.read()).toEqual({ attachments: [], content: [] });
  });
});
