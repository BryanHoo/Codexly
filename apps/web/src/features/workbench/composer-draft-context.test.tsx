import { describe, expect, it } from "vitest";

import { createComposerDraftScope, createComposerDraftStore } from "./composer-draft-context.js";

describe("ComposerDraftStore", () => {
  it("keeps editor drafts isolated by task scope", () => {
    const store = createComposerDraftStore();
    const firstScope = createComposerDraftScope("codexly", "task-1");
    const secondScope = createComposerDraftScope("codexly", "task-2");

    store.update(firstScope, (draft) => ({
      ...draft,
      content: [{ text: "稍后执行测试", type: "text" }],
    }));

    expect(store.read(firstScope).content).toEqual([{ text: "稍后执行测试", type: "text" }]);
    expect(store.read(secondScope).content).toEqual([]);
  });

  it("persists editor drafts across store recreation", () => {
    const scope = createComposerDraftScope("codexly", "task-1");
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => void values.delete(key),
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const firstStore = createComposerDraftStore(storage);
    firstStore.update(scope, (draft) => ({
      ...draft,
      content: [{ text: "仅保留在当前 Store", type: "text" }],
    }));

    expect(createComposerDraftStore(storage).read(scope).content).toEqual([
      { text: "仅保留在当前 Store", type: "text" },
    ]);

    firstStore.clear(scope);
    expect(createComposerDraftStore(storage).read(scope).content).toEqual([]);
  });
});
