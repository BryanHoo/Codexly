import { expect, it } from "vitest";
import { projectAcpFileChanges } from "./file-changes.js";
import { AcpEventProjection } from "./event-projection.js";

const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";

it.each([undefined, "", "--- a/other.ts\n+++ b/other.ts\n@@ -1 +1 @@\n-old\n+other\n"])(
  "同批后续记录没有可用补丁时保留已有正文并更新元数据：%s",
  (text) => {
    const projection = new AcpEventProjection("task", "turn", () => {
      // 本用例检查最终快照，无需收集增量事件。
    });
    projection.update({
      sessionUpdate: "tool_call_update",
      toolCallId: "edit",
      status: "completed",
      content: [
        {
          type: "diff",
          changes: [{ operation: "modify", path: "/repo/a.ts" }],
          patch: { format: "git_patch", text: patch },
        },
        {
          type: "diff",
          changes: [{ operation: "modify", path: "/repo/a.ts", mimeType: "text/typescript" }],
          ...(text !== undefined ? { patch: { format: "git_patch" as const, text } } : {}),
        },
      ],
    });
    const files = projection.finish("end_turn").items.find((item) => item.type === "file_change");
    expect(files?.changes).toEqual([
      {
        path: "/repo/a.ts",
        kind: "update",
        diff: patch,
        acp: { operation: "modify", mimeType: "text/typescript" },
      },
    ]);
  },
);

it("后续可用补丁替换已有正文", () => {
  const nextPatch = patch.replace("+new", "+latest");
  const changes = projectAcpFileChanges(
    [patch, nextPatch].map((text) => ({
      type: "diff",
      changes: [{ operation: "modify", path: "/repo/a.ts" }],
      patch: { format: "git_patch", text },
    })),
    256 * 1024,
  );
  expect(changes).toHaveLength(1);
  expect(changes[0]?.diff).toBe(nextPatch);
});
