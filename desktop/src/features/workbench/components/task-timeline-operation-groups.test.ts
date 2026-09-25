import type { AgentItem } from "@/protocol/index.js";
import { describe, expect, it } from "vitest";

import { groupConsecutiveTimelineOperations } from "./task-timeline-operation-groups.js";

function groupItems(items: readonly AgentItem[]) {
  const itemsById = new Map(items.map((item) => [item.id, item] as const));
  return groupConsecutiveTimelineOperations(
    items.map((item) => item.id),
    (itemKey) => itemsById.get(itemKey),
  );
}

const webSearch: AgentItem = {
  id: "search-1",
  name: "web_search",
  status: "completed",
  type: "tool",
};
const command: AgentItem = {
  command: "curl https://api.github.com/repos/example/project",
  cwd: "/workspace",
  id: "command-1",
  outputOmitted: { bytes: 0, lines: 0 },
  status: "completed",
  type: "command",
};
const mcpTool: AgentItem = {
  id: "mcp-1",
  name: "mcp__docs__search",
  status: "completed",
  type: "tool",
};
const fileChange: AgentItem = {
  changes: [
    { diff: "--- /dev/null\n+++ b/src/created.ts\n@@ -0,0 +1,1 @@\n+created\n", kind: "create", path: "src/created.ts", stats: { additions: 1, removals: 0 } },
    { diff: "--- a/src/updated.ts\n+++ b/src/updated.ts\n@@ -1,1 +1,1 @@\n-before\n+after\n", kind: "update", path: "src/updated.ts", stats: { additions: 1, removals: 1 } },
    { diff: "--- a/src/deleted.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-deleted\n", kind: "delete", path: "src/deleted.ts", stats: { additions: 0, removals: 1 } },
  ],
  id: "file-change-1",
  status: "completed",
  type: "file_change",
};

describe("groupConsecutiveTimelineOperations", () => {
  it("groups reasoning with tools and file edits", () => {
    expect(groupItems([
      { id: "reason-1", text: "**Inspect** files", type: "reasoning" },
      webSearch,
      fileChange,
    ])).toEqual([{ itemKeys: ["reason-1", "search-1", "file-change-1"], key: "reason-1", type: "operation_group" }]);
  });
  it("groups visually consecutive operations", () => {
    const items: AgentItem[] = [
      webSearch,
      command,
      mcpTool,
      fileChange,
      { id: "assistant-1", role: "assistant", text: "继续分析", type: "message" },
    ];

    expect(groupItems(items)).toEqual([
      {
        itemKeys: ["search-1", "command-1", "mcp-1", "file-change-1"],
        key: "search-1",
        type: "operation_group",
      },
      { itemKey: "assistant-1", type: "item" },
    ]);
  });

  it("groups multiple file changes stored in one item", () => {
    expect(groupItems([fileChange])).toEqual([
      {
        itemKeys: ["file-change-1"],
        key: "file-change-1",
        type: "operation_group",
      },
    ]);
  });
});
