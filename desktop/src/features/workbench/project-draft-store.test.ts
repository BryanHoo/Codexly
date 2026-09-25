import { describe, expect, it } from "vitest";

import { createProjectDraftStore } from "./project-draft-store.js";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("project draft store", () => {
  it("keeps saved drafts project-scoped and updates them only after an explicit save", () => {
    const storage = createMemoryStorage();
    const savedDrafts = createProjectDraftStore(storage, {
      createId: () => "draft-a",
      now: () => 1_000,
    });
    const original = {
      attachments: [],
      content: [{ text: "原始内容", type: "text" as const }],
    };
    const saved = savedDrafts.create("project-a", original);

    savedDrafts.updateWorking("project-a", saved.id, {
      attachments: [],
      content: [{ text: "未保存修改", type: "text" }],
    });

    expect(savedDrafts.read("project-a", saved.id)?.draft).toEqual(original);
    expect(savedDrafts.list("project-b")).toEqual([]);
    expect(savedDrafts.readWorking("project-a", saved.id)?.content).toEqual([
      { text: "未保存修改", type: "text" },
    ]);

    savedDrafts.save("project-a", saved.id, savedDrafts.readWorking("project-a", saved.id)!);

    expect(savedDrafts.read("project-a", saved.id)?.draft.content).toEqual([
      { text: "未保存修改", type: "text" },
    ]);
  });

  it("persists an empty working copy without changing the saved draft", () => {
    const storage = createMemoryStorage();
    const store = createProjectDraftStore(storage, { createId: () => "draft-a" });
    store.create("project-a", {
      attachments: [],
      content: [{ text: "保留原稿", type: "text" }],
    });

    store.updateWorking("project-a", "draft-a", { attachments: [], content: [] });

    const reloaded = createProjectDraftStore(storage);
    expect(reloaded.read("project-a", "draft-a")?.draft.content).toEqual([
      { text: "保留原稿", type: "text" },
    ]);
    expect(reloaded.readWorking("project-a", "draft-a")).toEqual({
      attachments: [],
      content: [],
    });
  });

  it("restores multiple project drafts in newest-first order", () => {
    const storage = createMemoryStorage();
    let now = 1_000;
    let sequence = 0;
    const store = createProjectDraftStore(storage, {
      createId: () => `draft-${String(++sequence)}`,
      now: () => now,
    });

    store.create("project-a", {
      attachments: [],
      content: [{ text: "第一条", type: "text" }],
    });
    now = 2_000;
    store.create("project-a", {
      attachments: [],
      content: [{ text: "第二条", type: "text" }],
    });

    const reloaded = createProjectDraftStore(storage);
    expect(reloaded.list("project-a").map((draft) => draft.id)).toEqual([
      "draft-2",
      "draft-1",
    ]);
  });

  it("persists a working copy without serializing unrelated project drafts", () => {
    const values = new Map<string, string>();
    const writes: Array<Readonly<{ key: string; value: string }>> = [];
    const storage: Storage = {
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => {
        values.set(key, value);
        writes.push({ key, value });
      },
    };
    let sequence = 0;
    const store = createProjectDraftStore(storage, {
      createId: () => `draft-${String(++sequence)}`,
    });
    store.create("project-a", {
      attachments: [],
      content: [{ text: "第一条", type: "text" }],
    });
    store.create("project-a", {
      attachments: [],
      content: [{ text: "第二条", type: "text" }],
    });
    writes.length = 0;

    store.updateWorking("project-a", "draft-1", {
      attachments: [],
      content: [{ text: "第一条修改", type: "text" }],
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toContain("draft-1");
    expect(writes[0]?.value).not.toContain("第二条");
  });
});
