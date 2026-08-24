import { describe, expect, it } from "vitest";

import { createComposerDraftScope, createComposerDraftStore } from "./composer-draft-context.js";

describe("ComposerDraftStore", () => {
  it("keeps editor drafts isolated by task scope", () => {
    const store = createComposerDraftStore();
    const firstScope = createComposerDraftScope("code-agent", "task-1");
    const secondScope = createComposerDraftScope("code-agent", "task-2");

    store.update(firstScope, (draft) => ({
      ...draft,
      content: [{ text: "稍后执行测试", type: "text" }],
    }));

    expect(store.read(firstScope).content).toEqual([{ text: "稍后执行测试", type: "text" }]);
    expect(store.read(secondScope).content).toEqual([]);
  });

  it("does not persist drafts or queues in sessionStorage", () => {
    const scope = createComposerDraftScope("code-agent", "task-1");
    const firstStore = createComposerDraftStore();
    firstStore.update(scope, (draft) => ({
      ...draft,
      content: [{ text: "仅保留在当前 Store", type: "text" }],
    }));

    expect(createComposerDraftStore().read(scope).content).toEqual([]);
  });
});
