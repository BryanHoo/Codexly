import { history, undo } from "@codemirror/commands";
import { expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import * as editor from "./text-editor-state.js";

it("rejects oversized input before it reaches the document or undo history", () => {
  const rejected: string[] = [];
  let state = editor.createTextEditorState("原文", history(), () => rejected.push("limit"));
  const before = state;
  state = state.update({ changes: { from: 0, insert: "a".repeat(2 * 1024 * 1024) } }).state;
  expect(state.doc === before.doc).toBe(true);
  expect(rejected).toEqual(["limit"]);
  expect(undo({ state, dispatch: () => undefined })).toBe(false);
});

it("counts UTF-8, CRLF and surrogate boundaries across adjacent and multiple edits", () => {
  let state = editor.createTextEditorState("\uFEFF中😀\r\n尾\ud800");
  const edits = [
    [{ from: 3, to: 4, insert: "" }],
    [
      { from: 2, insert: "\ud800" },
      { from: 3, insert: "\udc00" },
    ],
    [
      { from: 0, to: 1, insert: "字" },
      { from: 4, insert: "\r\n" },
    ],
    [{ from: 0, to: 3, insert: "😀" }],
  ];
  for (const changes of edits) {
    state = state.update({ changes }).state;
    expect(editor.getTextEditorByteLength(state)).toBe(
      new TextEncoder().encode(state.sliceDoc()).byteLength,
    );
  }
});

it("accepts exactly 2 MiB and rejects a multibyte edit beyond that boundary", () => {
  let state = editor.createTextEditorState("a".repeat(2 * 1024 * 1024 - 3));
  state = state.update({ changes: { from: state.doc.length, insert: "中" } }).state;
  expect(editor.getTextEditorByteLength(state)).toBe(2 * 1024 * 1024);
  const doc = state.doc;
  state = state.update({ changes: { from: 0, to: 1, insert: "😀" } }).state;
  expect(state.doc === doc).toBe(true);
});

it("matches serialized UTF-8 size across 500 deterministic Unicode edits", () => {
  let seed = 12345;
  const random = (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  const pieces = ["a", "中", "😀", "\ud800", "\udc00", "\r\n", "", "\uFEFF"];
  let state = editor.createTextEditorState("开头😀\r\n结尾");
  for (let index = 0; index < 500; index++) {
    const from = random(state.doc.length + 1);
    const to = from + random(state.doc.length - from + 1);
    state = state.update({
      changes: { from, to, insert: pieces[random(pieces.length)] ?? "" },
    }).state;
    expect(editor.getTextEditorByteLength(state)).toBe(
      new TextEncoder().encode(state.sliceDoc()).byteLength,
    );
  }
});

it("retains BOM and CRLF through changes and undo", () => {
  let state = editor.createTextEditorState("\uFEFF一\r\n二\r\n", history());
  const session = new editor.TextEditorSession(state.doc, "v1");
  state = state.update({ changes: { from: 2, to: 2, insert: "改" } }).state;
  expect(state.sliceDoc()).toBe("\uFEFF一改\r\n二\r\n");
  expect(session.isDirty(state.doc)).toBe(true);
  expect(
    undo({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    }),
  ).toBe(true);
  expect(state.sliceDoc()).toBe("\uFEFF一\r\n二\r\n");
  expect(session.isDirty(state.doc)).toBe(false);
});
it("keeps save snapshots separate from edits made while saving", () => {
  const session = new editor.TextEditorSession(EditorState.create({ doc: "before" }).doc, "v1");
  const submitted = EditorState.create({ doc: "submitted" }).doc;
  const current = EditorState.create({ doc: "newer" }).doc;
  session.markSaved(submitted, "v2");
  expect(session.isDirty(current)).toBe(true);
  expect(session.isDirty(submitted)).toBe(false);
  expect(session.version).toBe("v2");
});
it("does not treat undo back to the saved text as unsaved", () => {
  const saved = EditorState.create({ doc: "saved" }).doc;
  const session = new editor.TextEditorSession(saved, "v1");
  expect(session.isDirty(EditorState.create({ doc: "changed" }).doc)).toBe(true);
  expect(session.isDirty(EditorState.create({ doc: "saved" }).doc)).toBe(false);
});
