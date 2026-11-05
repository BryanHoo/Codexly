import { resolveCompletedTurnProcessItemIds } from "./task-timeline-process.js";
import type { AgentItem } from "@codexly/protocol";
import { describe, expect, it } from "vitest";
import {
  filterRenderableTimelineItemKeys,
  groupConsecutiveTimelineOperations,
} from "./task-timeline-operation-groups.js";
import { createConversationDisplayPreferenceStore } from "@codexly/frontend-core/conversation-display-preferences";

const file: AgentItem = {
  id: "file",
  type: "file_change",
  status: "completed",
  changes: [{ path: "profile.js", kind: "update", diff: "@@ -1 +1 @@\n-old\n+new" }],
};
const command: AgentItem = {
  id: "command",
  type: "command",
  command: "pwd",
  outputOmitted: { bytes: 0, lines: 0 },
  cwd: ".",
  status: "completed",
};

describe("独立流式文件差异", () => {
  it("默认开启并独立持久保存关闭选择", () => {
    let value = '{"navigation":true}';
    const storage = {
      getItem: () => value,
      setItem: (_: string, next: string) => {
        value = next;
      },
    };
    const store = createConversationDisplayPreferenceStore(storage, "display");
    expect(store.getSnapshot().independentFileDiffs).toBe(true);
    store.set("independentFileDiffs", false);
    expect(
      createConversationDisplayPreferenceStore(storage, "display").getSnapshot(),
    ).toMatchObject({ independentFileDiffs: false, navigation: true });
  });
  it("开启时将文件差异从前后命令组分离，关闭保留原分组", () => {
    const items = new Map<string, AgentItem>([
      ["a", command],
      ["file", file],
      ["b", command],
    ]);
    expect(
      groupConsecutiveTimelineOperations(["a", "file", "b"], (k) => items.get(k), true),
    ).toEqual([
      { type: "operation_group", key: "a", itemKeys: ["a"] },
      { type: "item", itemKey: "file" },
      { type: "operation_group", key: "b", itemKeys: ["b"] },
    ]);
    expect(groupConsecutiveTimelineOperations(["a", "file", "b"], (k) => items.get(k))).toEqual([
      { type: "operation_group", key: "a", itemKeys: ["a", "file", "b"] },
    ]);
  });
});

it.each(["completed", "failed", "declined", "interrupted"])(
  "过程展开后保留 %s 文件项",
  (status) => {
    const itemStore = { peek: () => ({ ...file, status }) };
    const stores = new Map([["file", itemStore]]) as unknown as Parameters<
      typeof filterRenderableTimelineItemKeys
    >[1];
    expect(filterRenderableTimelineItemKeys(["file"], stores, "completed", true)).toEqual(["file"]);
    expect(filterRenderableTimelineItemKeys(["file"], stores, "completed", false)).toEqual([]);
  },
);

it("独立差异完成后收入过程，不受最终答复位置影响", () => {
  const answer: AgentItem = {
    id: "answer",
    type: "message",
    role: "assistant",
    phase: "final_answer",
    text: "完成",
  };
  for (const items of [[file], [file, answer], [answer, file]]) {
    expect(resolveCompletedTurnProcessItemIds(items, "completed", false, true)).toEqual(["file"]);
    expect(resolveCompletedTurnProcessItemIds(items, "running", false, true)).toEqual([]);
    expect(resolveCompletedTurnProcessItemIds(items, "completed", false, false)).toEqual([]);
  }
});
