import { history, undo } from "@codemirror/commands";
import { expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import * as editor from "./text-editor-state.js";

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
