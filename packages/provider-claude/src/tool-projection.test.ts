import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { AgentItemSchema, type AgentTurn } from "@codexly/protocol";
import type { AgentProviderEvent } from "@codexly/core";
import { ClaudeTurnProjection } from "./turn-projection.js";
import { createProjection } from "./session.js";

function setup(name: string, input: unknown = {}) {
  const events: AgentProviderEvent[] = [];
  const turn = new ClaudeTurnProjection("task", "turn", undefined, (event) => events.push(event));
  turn.receive({ type: "system", subtype: "init", cwd: "/project" });
  const use = {
    type: "assistant",
    message: { id: "message", content: [{ type: "tool_use", id: "tool", name, input }] },
  };
  turn.receive(use);
  const result = (output: unknown, is_error = false, content = "tool result") => {
    turn.receive({
      type: "user",
      tool_use_result: output,
      message: { content: [{ type: "tool_result", tool_use_id: "tool", is_error, content }] },
    });
  };
  return {
    turn,
    events,
    use,
    result,
    item: () => turn.snapshot().items.find((item) => item.id === "tool"),
  };
}

const patch = [
  {
    oldStart: 10,
    oldLines: 1,
    newStart: 10,
    newLines: 2,
    lines: ["-before", "+after", "+accepted"],
  },
];
const edit = {
  filePath: "/project/actual.ts",
  oldString: "before",
  newString: "after\naccepted",
  originalFile: "before",
  structuredPatch: patch,
  userModified: true,
  replaceAll: false,
};

describe("Claude file result projection", () => {
  it("preserves multiple actual hunks for replace_all instead of diffing requested strings", () => {
    const { result, item } = setup("Edit", {
      replace_all: true,
      old_string: "before",
      new_string: "ignored",
    });
    result({
      ...edit,
      replaceAll: true,
      structuredPatch: [...patch, { ...patch[0], oldStart: 30, newStart: 31 }],
    });
    const projected = item();
    expect(projected?.type).toBe("file_change");
    if (projected?.type === "file_change") {
      expect(projected.changes[0]?.diff).toContain("@@ -30,1 +31,2 @@");
      expect(projected.changes[0]?.diff).not.toContain("ignored");
    }
  });

  it("does not create a change for a confirmed no-op write", () => {
    const { result, item } = setup("Write");
    result({
      type: "update",
      filePath: "/project/same.txt",
      content: "same",
      originalFile: "same",
      structuredPatch: [],
    });
    expect(item()?.type).toBe("tool");
  });
  it("uses the successful result's path and patch and preserves identity on replay", () => {
    const { turn, result, item, use, events } = setup("Edit", {
      file_path: "/project/proposed.ts",
      old_string: "wrong",
      new_string: "unapproved",
    });
    expect(item()?.type).toBe("tool");
    result(edit);
    expect(item()).toEqual({
      id: "tool",
      type: "file_change",
      status: "completed",
      changes: [
        {
          path: edit.filePath,
          kind: "update",
          diff: "--- a/project/actual.ts\n+++ b/project/actual.ts\n@@ -10,1 +10,2 @@\n-before\n+after\n+accepted\n",
        },
      ],
    });
    expect(events.at(-1)).toMatchObject({
      type: "item.completed",
      itemId: "tool",
      payload: { item: { type: "file_change" } },
    });
    const completed = item();
    turn.receive(use);
    result(edit);
    expect(item()).toEqual(completed);
    expect(events.filter((event) => event.type === "item.completed")).toHaveLength(1);
  });

  it.each(["Edit", "Write"])(
    "never treats pending, denied or staged %s as an applied change",
    (name) => {
      const value = name === "Write" ? { ...edit, type: "create", content: "accepted" } : edit;
      const pending = setup(name, { file_path: edit.filePath, content: "unapproved" });
      pending.turn.finish("interrupted");
      expect(pending.item()?.type).toBe("tool");
      const denied = setup(name);
      denied.result(value, true, "Permission denied");
      expect(denied.item()).toMatchObject({ type: "tool", status: "failed" });
      const staged = setup(name);
      staged.result({ ...value, staged: true });
      expect(staged.item()?.type).toBe("tool");
    },
  );

  it("builds new-file diffs from returned content, including a missing final newline", () => {
    const { result, item } = setup("Write", { content: "wrong" });
    result({
      type: "create",
      filePath: "/project/new.txt",
      content: "first\nlast",
      originalFile: null,
      structuredPatch: [],
    });
    expect(item()).toMatchObject({
      type: "file_change",
      changes: [
        {
          kind: "create",
          diff: "--- /dev/null\n+++ b/project/new.txt\n@@ -0,0 +1,2 @@\n+first\n+last\n\\ No newline at end of file\n",
        },
      ],
    });
  });

  it("keeps an update without a patch unknown instead of inventing an addition", () => {
    const { result, item } = setup("Write");
    result({
      type: "update",
      filePath: "/project/large.txt",
      content: "new",
      originalFile: null,
      structuredPatch: [],
    });
    expect(item()).toMatchObject({ type: "file_change", changes: [{ kind: "update", diff: "" }] });
  });

  it.each([undefined, {}, { ...edit, structuredPatch: [{ ...patch[0], lines: ["untrusted"] }] }])(
    "retains generic results when structured evidence is missing or malformed",
    (output) => {
      const { result, item } = setup("Edit", {
        file_path: edit.filePath,
        old_string: "a",
        new_string: "b",
      });
      result(output);
      expect(item()?.type).toBe("tool");
    },
  );

  it("does not apply one message's structured output to multiple tool results", () => {
    const { turn, item } = setup("Edit");
    turn.receive({
      type: "user",
      tool_use_result: edit,
      message: {
        content: [
          { type: "tool_result", tool_use_id: "other", content: "ok" },
          { type: "tool_result", tool_use_id: "tool", content: "ok" },
        ],
      },
    });
    expect(item()?.type).toBe("tool");
  });
});

describe("Claude command result projection", () => {
  it("retains the task working directory when a reused SDK query emits no init", () => {
    const { projection } = createProjection(
      "task",
      "next",
      undefined,
      () => undefined,
      undefined,
      "/task/cwd",
    );
    projection.receive({
      type: "assistant",
      message: {
        id: "m",
        content: [{ type: "tool_use", id: "b", name: "Bash", input: { command: "pwd" } }],
      },
    });
    projection.receive({
      type: "user",
      tool_use_result: { stdout: "/task/cwd", stderr: "", interrupted: false },
      message: { content: [{ type: "tool_result", tool_use_id: "b", content: "ok" }] },
    });
    expect(projection.snapshot().items[0]).toMatchObject({ type: "command", cwd: "/task/cwd" });
  });
  it("uses actual output and cwd without inventing an exit code or treating notices as failure", () => {
    const { result, item } = setup("Bash", { command: "printf done" });
    result({ stdout: "done\n", stderr: "cwd reset", interrupted: false });
    expect(item()).toEqual({
      id: "tool",
      type: "command",
      command: "printf done",
      cwd: "/project",
      output: "done\ncwd reset",
      outputOmitted: { bytes: 0, lines: 0 },
      status: "completed",
    });
  });

  it.each([false, true])(
    "preserves failed and interrupted results (interrupted=%s)",
    (interrupted) => {
      const { result, item } = setup("Bash", { command: "exit 2" });
      result({ stdout: "partial", stderr: "", interrupted }, true);
      expect(item()).toMatchObject({
        type: "command",
        status: interrupted ? "interrupted" : "failed",
        output: "partial",
      });
      expect(item()).not.toHaveProperty("exitCode");
    },
  );

  it("uses model-facing error text when the SDK provides no structured output", () => {
    const { result, item } = setup("Bash", { command: "exit 2" });
    result(undefined, true, "Exit code 2\nfailure");
    expect(item()).toMatchObject({
      type: "command",
      status: "failed",
      output: "Exit code 2\nfailure",
    });
    expect(item()).not.toHaveProperty("exitCode");
  });

  it("does not report a background dispatch or image as a completed command", () => {
    for (const extra of [{ backgroundTaskId: "background" }, { isImage: true }]) {
      const { result, item } = setup("Bash", { command: "work" });
      result({ stdout: "", stderr: "", interrupted: false, ...extra });
      expect(item()?.type).toBe("tool");
    }
  });
});

it("projects child edits inside the child preview without adding changes to the parent", () => {
  const { turn, item } = setup("Agent", { prompt: "edit" });
  turn.receive({
    type: "assistant",
    parent_tool_use_id: "tool",
    message: {
      id: "child",
      content: [{ type: "tool_use", id: "child-edit", name: "Edit", input: {} }],
    },
  });
  turn.receive({
    type: "user",
    parent_tool_use_id: "tool",
    tool_use_result: edit,
    message: { content: [{ type: "tool_result", tool_use_id: "child-edit", content: "ok" }] },
  });
  expect(turn.snapshot().items.some((entry) => entry.type === "file_change")).toBe(false);
  const parent = item();
  expect(parent?.type).toBe("tool");
  if (parent?.type === "tool") {
    const output = parent.output as { turn: AgentTurn };
    expect(output.turn.items.find((entry) => entry.id === "child-edit")).toMatchObject({
      type: "file_change",
      status: "completed",
    });
  }
});

it.each(["Write", "Edit", "Bash"])(
  "bounds large %s results and keeps emitted items valid",
  (name) => {
    const { result, item, events, turn } = setup(name, { command: "printf large" });
    const content = `BEGIN\n${"中文🦀\n".repeat(100000)}END`;
    result(
      name === "Bash"
        ? { stdout: content, stderr: "", interrupted: false }
        : name === "Write"
          ? {
              type: "create",
              filePath: "/project/big",
              content,
              originalFile: null,
              structuredPatch: [],
            }
          : {
              ...edit,
              structuredPatch: [
                {
                  oldStart: 1,
                  oldLines: 0,
                  newStart: 1,
                  newLines: 100002,
                  lines: content.split("\n").map((line) => `+${line}`),
                },
              ],
            },
    );
    expect(item()?.type).toBe(name === "Bash" ? "command" : "file_change");
    expect(JSON.stringify(item())).toContain("省略");
    expect(JSON.stringify(item())).not.toContain("�");
    const projected = item();
    if (projected?.type === "command") {
      expect(projected.outputOmitted.bytes).toBeGreaterThan(0);
      expect(projected.outputOmitted.lines).toBeGreaterThan(0);
    }
    turn.finish("completed");
    for (const event of events) {
      expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(512 * 1024);
      if (event.type === "item.completed" || event.type === "item.started")
        expect(Value.Check(AgentItemSchema, event.payload.item)).toBe(true);
    }
  },
);
