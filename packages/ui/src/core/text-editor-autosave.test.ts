import { expect, it, vi } from "vitest";
import { createTextEditorState } from "./text-editor-state.js";
import * as autosave from "./text-editor-autosave.js";

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
  expect(await session.flush()).toBe(true);
  expect(save.mock.calls[1]?.[0]).toMatchObject({ expectedVersion: "v1" });
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
