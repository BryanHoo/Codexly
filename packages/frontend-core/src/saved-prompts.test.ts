import { describe, expect, it } from "vitest";
import {
  createSavedPromptStore,
  getSavedPromptCommands,
  selectSavedPromptsForProject,
  SAVED_PROMPTS_STORAGE_KEY,
} from "./saved-prompts.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
const draft = { name: "代码检查", shortcut: "check", content: "逐项检查代码。\n保留现有行为。" };

describe("saved prompts", () => {
  it("persists create, update and delete across store instances", () => {
    const storage = memoryStorage();
    const store = createSavedPromptStore(storage);
    const prompt = store.save(draft);
    expect(createSavedPromptStore(storage).getSnapshot()).toEqual([prompt]);
    store.save({ ...draft, content: "新内容" }, prompt.id);
    expect(createSavedPromptStore(storage).getSnapshot()[0]?.content).toBe("新内容");
    store.remove(prompt.id);
    expect(createSavedPromptStore(storage).getSnapshot()).toEqual([]);
  });

  it("validates empty fields, shortcut syntax and case insensitive duplicates", () => {
    const store = createSavedPromptStore(memoryStorage());
    store.save(draft);
    expect(() => store.save({ ...draft, shortcut: "CHECK" })).toThrow("duplicate");
    expect(() => store.save({ ...draft, name: " " })).toThrow("name");
    expect(() => store.save({ ...draft, content: "\n " })).toThrow("content");
    expect(() => store.save({ ...draft, shortcut: "two words" })).toThrow("shortcut");
    expect(store.save({ ...draft, shortcut: "检查" }).shortcut).toBe("检查");
  });

  it("keeps the saved snapshot when storage fails and permits retry", () => {
    const storage = memoryStorage();
    const store = createSavedPromptStore(storage);
    const prompt = store.save(draft);
    const write = storage.setItem;
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(() => {
      store.remove(prompt.id);
    }).toThrow("quota");
    expect(store.getSnapshot()).toEqual([prompt]);
    storage.setItem = write;
    store.remove(prompt.id);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("refreshes external changes without changing unchanged snapshot identity", () => {
    const storage = memoryStorage();
    const store = createSavedPromptStore(storage);
    const initial = store.getSnapshot();
    store.refresh();
    expect(store.getSnapshot()).toBe(initial);
    const other = createSavedPromptStore(storage);
    const prompt = other.save(draft);
    store.refresh();
    expect(store.getSnapshot()).toEqual([prompt]);
  });

  it("ignores malformed persisted records and exposes searchable insertion commands", () => {
    const storage = memoryStorage();
    storage.setItem(
      SAVED_PROMPTS_STORAGE_KEY,
      JSON.stringify({ version: 1, prompts: [null, { id: "x", ...draft }, { id: "invalid" }] }),
    );
    const store = createSavedPromptStore(storage);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(getSavedPromptCommands(store.getSnapshot())).toEqual([
      expect.objectContaining({
        action: "saved-prompt",
        label: "/check · 代码检查",
        keywords: ["check", "代码检查"],
        content: draft.content,
      }),
    ]);
    storage.setItem(SAVED_PROMPTS_STORAGE_KEY, "not json");
    store.refresh();
    expect(store.getSnapshot()).toEqual([]);
  });
});

describe("project prompt scope", () => {
  it("defaults prompts to global, persists project scopes and overrides global shortcuts locally", () => {
    const storage = memoryStorage();
    const store = createSavedPromptStore(storage);
    const global = store.save(draft);
    const a = store.save({ ...draft, projectId: "a", content: "项目 A" });
    const b = store.save({ ...draft, projectId: "b", content: "项目 B" });
    const unique = store.save({ ...draft, shortcut: "other" });
    const reloaded = createSavedPromptStore(storage).getSnapshot();
    expect(reloaded).toEqual([global, a, b, unique]);
    expect(selectSavedPromptsForProject(reloaded)).toEqual([global, unique]);
    expect(selectSavedPromptsForProject(reloaded, "a")).toEqual([a, unique]);
    expect(selectSavedPromptsForProject(reloaded, "b")).toEqual([b, unique]);
    expect(() => store.save({ ...draft, shortcut: "CHECK", projectId: "a" })).toThrow("duplicate");
    expect(() => store.save({ ...draft, projectId: "a" }, global.id)).toThrow("duplicate");
    store.save({ ...draft, shortcut: "moved", projectId: "b" }, a.id);
    expect(selectSavedPromptsForProject(store.getSnapshot(), "a")).toEqual([global, unique]);
  });

  it("deletes all prompts only for the removed project and persists the cleanup", () => {
    const storage = memoryStorage();
    const store = createSavedPromptStore(storage);
    const global = store.save(draft);
    store.save({ ...draft, projectId: "a" });
    store.save({ ...draft, projectId: "a", shortcut: "second" });
    const b = store.save({ ...draft, projectId: "b" });
    store.removeProject("a");
    expect(createSavedPromptStore(storage).getSnapshot()).toEqual([global, b]);
  });

  it("rejects malformed project scopes instead of exposing them globally", () => {
    const storage = memoryStorage();
    storage.setItem(
      SAVED_PROMPTS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        prompts: [
          { id: "global", ...draft },
          ...["", null, 123].map((projectId, index) => ({
            id: String(index),
            ...draft,
            shortcut: `invalid${String(index)}`,
            projectId,
          })),
        ],
      }),
    );
    expect(
      createSavedPromptStore(storage)
        .getSnapshot()
        .map((prompt) => prompt.id),
    ).toEqual(["global"]);
  });

  it("checks storage permission before remote deletion without removing prompts", () => {
    const storage = memoryStorage();
    const store = createSavedPromptStore(storage);
    const prompt = store.save({ ...draft, projectId: "a" });
    store.assertProjectRemovalWritable("a");
    expect(store.getSnapshot()).toEqual([prompt]);
    storage.setItem = () => {
      throw new Error("denied");
    };
    expect(() => {
      store.assertProjectRemovalWritable("a");
    }).toThrow("denied");
    expect(() => {
      store.removeProject("a");
    }).toThrow("denied");
    expect(store.getSnapshot()).toEqual([prompt]);
  });
});
