import { expect, it, vi } from "vitest";
import { createTextEditorState } from "./text-editor-state.js";
import * as autosave from "./text-editor-autosave.js";
import { EditorState } from "@codemirror/state";

const file = { path: "notes.md", content: "原文\r\n", version: "v1" };
function setup(save = vi.fn(() => Promise.resolve({ version: "v2" }))) {
  const notify = vi.fn();
  const saved = vi.fn();
  const session = new autosave.TextEditorAutosave(file, save, saved, notify);
  const edit = (text: string) => {
    session.update(createTextEditorState(text));
  };
  return { session, save, notify, saved, edit };
}

it("does not write on input or unchanged blur; flush saves the latest CRLF text once", async () => {
  const { session, save, notify, edit } = setup();
  expect(await session.flush()).toBe(true);
  expect(save).not.toHaveBeenCalled();
  edit("修改\r\n");
  expect(save).not.toHaveBeenCalled();
  expect(await session.flush()).toBe(true);
  expect(save).toHaveBeenCalledWith({
    path: "notes.md",
    content: "修改\r\n",
    expectedVersion: "v1",
  });
  expect(notify).toHaveBeenCalledWith("saved");
  expect(session.dirty).toBe(false);
  await session.flush();
  expect(save).toHaveBeenCalledTimes(1);
});

it("serializes overlapping blurs and drains edits made while a save is in flight", async () => {
  let resolve!: (value: { version: string }) => void;
  const save = vi.fn(
    () =>
      new Promise<{ version: string }>((done) => {
        resolve = done;
      }),
  );
  const { session, edit, notify } = setup(save);
  edit("第一次");
  const first = session.flush();
  edit("第二次");
  const second = session.flush();
  expect(save).toHaveBeenCalledTimes(1);
  resolve({ version: "v2" });
  await vi.waitFor(() => {
    expect(save).toHaveBeenCalledTimes(2);
  });
  expect(save.mock.calls[1]).toEqual([
    { path: "notes.md", content: "第二次", expectedVersion: "v2" },
  ]);
  resolve({ version: "v3" });
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(session.dirty).toBe(false);
});

it("keeps a failed draft and version, reports failure and permits a later retry", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ version: "v2" });
  const { session, edit, notify } = setup(save);
  edit("不能丢失");
  expect(await session.flush()).toBe(false);
  expect(session.state.sliceDoc()).toBe("不能丢失");
  expect(session.dirty).toBe(true);
  expect(notify).toHaveBeenCalledWith("error");
  expect(session.feedback).toBe("error");
  expect(await session.flush()).toBe(true);
  expect(session.feedback).toBeNull();
  expect(save.mock.calls[1]?.[0]).toMatchObject({ expectedVersion: "v1" });
});

it("keeps the save failure visible when an input-limit notice is dismissed", async () => {
  const { session } = setup(vi.fn().mockRejectedValue(new Error("offline")));
  session.update(session.state.update({ changes: { from: 0, insert: "保留" } }).state);
  await session.flush();
  session.update(
    session.state.update({ changes: { from: 0, insert: "a".repeat(2 * 1024 * 1024) } }).state,
  );
  expect(session.feedback).toBe("input-limit");
  session.dismissInputLimit();
  expect(session.feedback).toBe("error");
  expect(session.state.sliceDoc()).toBe("保留原文\r\n");
});

it("clears the input-limit notice on the next accepted edit and keeps ordinary editing available", () => {
  const { session } = setup();
  session.update(
    session.state.update({ changes: { from: 0, insert: "a".repeat(2 * 1024 * 1024) } }).state,
  );
  expect(session.feedback).toBe("input-limit");
  session.update(session.state.update({ changes: { from: 0, insert: "可以继续" } }).state);
  expect(session.feedback).toBeNull();
  expect(session.state.sliceDoc()).toBe("可以继续原文\r\n");
});

it("reports conflicts without overwriting or discarding the local draft", async () => {
  const { session, edit, notify, save } = setup(
    vi.fn().mockRejectedValue({ code: "TEXT_FILE_CONFLICT" }),
  );
  edit("保留草稿");
  expect(await session.flush()).toBe(false);
  expect(notify).toHaveBeenCalledWith("conflict");
  expect(session.state.sliceDoc()).toBe("保留草稿");
  expect(save).toHaveBeenCalledTimes(1);
});

it("restores a failed draft after changing files and releases it after a successful retry", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ version: "v2" });
  const { session, edit } = setup(save);
  const scope = {};
  edit("切换文件也不能丢");
  autosave.retainTextEditorDraft(scope, "a", session);
  await vi.waitFor(() => {
    expect(session.saving).toBe(false);
  });
  expect(autosave.getTextEditorDraft(scope, "a")?.state.sliceDoc()).toBe("切换文件也不能丢");
  expect(autosave.getTextEditorDraft({}, "a")).toBeUndefined();
  await session.flush();
  expect(autosave.getTextEditorDraft(scope, "a")).toBeUndefined();
});

it("rejects an oversized edit without calling the file service", async () => {
  const { session, edit, save, notify } = setup();
  edit("a".repeat(2 * 1024 * 1024 + 1));
  expect(await session.flush()).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(session.dirty).toBe(true);
  expect(notify).toHaveBeenCalledWith("error");
});

it("disables parsing in the growth transaction and restores it after shrinking", () => {
  const { session } = setup();
  session.update(
    session.state.update({ effects: session.installLanguage(EditorState.tabSize.of(9)) }).state,
  );
  expect(session.state.tabSize).toBe(9);
  session.update(session.state.update({ changes: { from: 0, insert: "中".repeat(90_000) } }).state);
  expect(session.byteLength).toBeGreaterThan(256 * 1024);
  expect(session.state.tabSize).toBe(4);
  session.update(session.state.update({ changes: { from: 0, to: 270_000 / 3 } }).state);
  expect(session.state.tabSize).toBe(9);
});

it("does not reenable parsing when an asynchronous language load finishes above the limit", () => {
  const { session } = setup();
  session.update(session.state.update({ changes: { from: 0, insert: "a".repeat(300_000) } }).state);
  session.update(
    session.state.update({ effects: session.installLanguage(EditorState.tabSize.of(9)) }).state,
  );
  expect(session.state.tabSize).toBe(4);
});

it("compacts an in-flight draft without losing its text tree, CRLF policy, selection or save snapshot", async () => {
  let resolve!: (value: { version: string }) => void;
  const { session } = setup(
    vi.fn(
      () =>
        new Promise<{ version: string }>((done) => {
          resolve = done;
        }),
    ),
  );
  session.update(
    session.state.update({
      changes: { from: 0, to: session.state.doc.length, insert: "修改" },
      selection: { anchor: 1 },
    }).state,
  );
  const doc = session.state.doc;
  const saving = session.flush();
  session.compactDraft();
  expect(session.state.doc === doc).toBe(true);
  expect(session.state.selection.main.anchor).toBe(1);
  expect(session.state.lineBreak).toBe("\r\n");
  expect(session.version).toBe("v1");
  resolve({ version: "v2" });
  expect(await saving).toBe(true);
  expect(session.dirty).toBe(false);
  session.update(session.state.update({ changes: { from: 2, insert: "\r\n新行" } }).state);
  expect(session.state.sliceDoc()).toBe("修改\r\n新行");
});
