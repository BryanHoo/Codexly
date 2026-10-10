import { expect, it, vi } from "vitest";
import { historyField, undo } from "@codemirror/commands";
import { TextEditorSessionCache } from "./text-editor-session-cache.js";
import { TextEditorCapacity } from "./text-editor-capacity.js";

function fixture(maxEntries = 16, maxBytes = 64 * 1024 * 1024) {
  const scope = {};
  const cache = new TextEditorSessionCache(scope, maxEntries, maxBytes);
  let file = { path: "a.txt", content: "原文\r\n", version: "v1", revision: "r1" };
  const callbacks = {
    read: vi.fn((_signal: AbortSignal) => Promise.resolve(file)),
    checkRevision: vi.fn((_signal: AbortSignal) => Promise.resolve({ revision: file.revision })),
    save: vi.fn(() => Promise.resolve({ version: "v2", revision: "r2" })),
    onSaved: vi.fn(),
    notify: vi.fn(),
  };
  return {
    cache,
    callbacks,
    change: (next: typeof file) => {
      file = next;
    },
  };
}

it("reuses four saved sessions across twelve focus switches without reading their full text again", async () => {
  const { cache, callbacks } = fixture();
  const sessions = new Map();
  for (let i = 0; i <= 12; i++) {
    const key = String(i % 4);
    const lease = cache.acquire(key, callbacks);
    const session = await lease.ready;
    if (sessions.has(key)) expect(session).toBe(sessions.get(key));
    sessions.set(key, session);
    lease.release();
  }
  expect(callbacks.read).toHaveBeenCalledTimes(4);
  expect(callbacks.checkRevision).toHaveBeenCalledTimes(9);
});

it("retains the text tree, CRLF, selection and undo history through view rebinding", async () => {
  const { cache, callbacks } = fixture();
  const first = cache.acquire("a", callbacks);
  const session = await first.ready;
  session.update(
    session.state.update({ changes: { from: 0, insert: "改" }, selection: { anchor: 1 } }).state,
  );
  await session.flush();
  const doc = session.state.doc;
  const history = session.state.field(historyField);
  session.bindView([]);
  first.release();
  callbacks.checkRevision.mockResolvedValue({ revision: "r2" });
  const next = cache.acquire("a", callbacks);
  expect(await next.ready).toBe(session);
  session.bindView([]);
  expect(session.state.doc).toBe(doc);
  expect(session.state.field(historyField)).toBe(history);
  expect(session.state.selection.main.anchor).toBe(1);
  expect(session.state.sliceDoc()).toBe("改原文\r\n");
  expect(
    undo({
      state: session.state,
      dispatch: (transaction) => {
        session.update(transaction.state);
      },
    }),
  ).toBe(true);
  expect(session.state.sliceDoc()).toBe("原文\r\n");
  await session.flush();
  next.release();
  expect(callbacks.read).toHaveBeenCalledTimes(1);
});

it("deduplicates an unfinished native read across rapid unmounts and remounts", async () => {
  const { cache, callbacks } = fixture();
  let resolve!: (file: Awaited<ReturnType<typeof callbacks.read>>) => void;
  callbacks.read.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = cache.acquire("a", callbacks);
  first.release();
  const second = cache.acquire("a", callbacks);
  second.release();
  const third = cache.acquire("a", callbacks);
  expect(callbacks.read).toHaveBeenCalledTimes(1);
  expect(callbacks.read.mock.calls[0]?.[0].aborted).toBe(false);
  resolve({ path: "a.txt", content: "pending", version: "v1", revision: "r1" });
  expect(await third.ready).toBe(await first.ready);
  third.release();
});

it("reloads an external version but preserves history when only metadata changed", async () => {
  const { cache, callbacks, change } = fixture();
  const first = cache.acquire("a", callbacks);
  const old = await first.ready;
  first.release();
  change({ path: "a.txt", content: "原文\r\n", version: "v1", revision: "r2" });
  const metadata = cache.acquire("a", callbacks);
  expect(await metadata.ready).toBe(old);
  metadata.release();
  change({ path: "a.txt", content: "external", version: "v3", revision: "r3" });
  const changed = cache.acquire("a", callbacks);
  expect(await changed.ready).not.toBe(old);
  expect((await changed.ready).state.sliceDoc()).toBe("external");
  changed.release();
  expect(callbacks.read).toHaveBeenCalledTimes(3);
});

it("evicts the oldest idle session by entry count and separately by byte budget", async () => {
  for (const [count, bytes] of [
    [1, 64 * 1024 * 1024],
    [16, 1],
  ]) {
    const { cache, callbacks } = fixture(count, bytes);
    const first = cache.acquire("a", callbacks);
    const original = await first.ready;
    first.release();
    const other = cache.acquire("b", callbacks);
    await other.ready;
    other.release();
    const again = cache.acquire("a", callbacks);
    expect(await again.ready).not.toBe(original);
    again.release();
    expect(callbacks.read).toHaveBeenCalledTimes(3);
  }
});

it("pins failed drafts outside the idle budget and does not read or validate over them", async () => {
  const { cache, callbacks } = fixture(1, 1);
  callbacks.save.mockRejectedValue(new Error("offline"));
  const first = cache.acquire("a", callbacks);
  const session = await first.ready;
  session.update(session.state.update({ changes: { from: 0, insert: "保留" } }).state);
  first.release();
  await vi.waitFor(() => {
    expect(session.saving).toBe(false);
  });
  const other = cache.acquire("b", callbacks);
  await other.ready;
  other.release();
  const again = cache.acquire("a", callbacks);
  expect(await again.ready).toBe(session);
  expect(callbacks.read).toHaveBeenCalledTimes(2);
  expect(callbacks.checkRevision).not.toHaveBeenCalled();
  callbacks.save.mockResolvedValue({ version: "v2", revision: "r2" });
  await session.flush();
  again.release();
});

it("does not display a stale saved session after a failed revision check and permits retry", async () => {
  const { cache, callbacks } = fixture();
  const first = cache.acquire("a", callbacks);
  await first.ready;
  first.release();
  callbacks.checkRevision.mockRejectedValueOnce(new Error("deleted"));
  const failed = cache.acquire("a", callbacks);
  await expect(failed.ready).rejects.toThrow("deleted");
  failed.release();
  const retry = cache.acquire("a", callbacks);
  await retry.ready;
  retry.release();
  expect(callbacks.read).toHaveBeenCalledTimes(2);
});

it("keeps active entries pinned and isolates caches for distinct clients", async () => {
  const { cache, callbacks } = fixture(1, 1);
  const first = cache.acquire("a", callbacks);
  const session = await first.ready;
  const second = cache.acquire("a", callbacks);
  expect(await second.ready).toBe(session);
  const isolated = new TextEditorSessionCache({}).acquire("a", callbacks);
  expect(await isolated.ready).not.toBe(session);
  first.release();
  second.release();
  isolated.release();
});

it("reserves draft capacity across clients, blocks new reads and recovers the failed draft", async () => {
  for (const [count, bytes] of [
    [1, 32 * 1024 * 1024],
    [16, 2 * 1024 * 1024],
  ]) {
    const capacity = new TextEditorCapacity(count, bytes);
    const { callbacks } = fixture();
    callbacks.save.mockRejectedValue(new Error("offline"));
    const cache = new TextEditorSessionCache({}, 16, 64 * 1024 * 1024, capacity);
    const first = cache.acquire("draft", callbacks);
    const session = await first.ready;
    session.update(session.state.update({ changes: { from: 0, insert: "不能丢" } }).state);
    first.release();
    await vi.waitFor(() => {
      expect(session.saving).toBe(false);
    });
    const other = new TextEditorSessionCache({}, 16, 64 * 1024 * 1024, capacity);
    const blocked = other.acquire("next", callbacks);
    await expect(blocked.ready).rejects.toMatchObject({ code: "TEXT_EDITOR_CAPACITY" });
    blocked.release();
    expect(callbacks.read).toHaveBeenCalledTimes(1);
    const recovered = cache.acquire("draft", callbacks);
    expect(await recovered.ready).toBe(session);
    expect(session.state.sliceDoc()).toBe("不能丢原文\r\n");
    expect(undo({ state: session.state, dispatch: () => undefined })).toBe(false);
    callbacks.save.mockResolvedValue({ version: "v2", revision: "r2" });
    await session.flush();
    // 草稿已保存但编辑器仍活动时继续预留，以免下一次输入重新变脏后失去名额。
    const activeBlocked = other.acquire("next", callbacks);
    await expect(activeBlocked.ready).rejects.toMatchObject({ code: "TEXT_EDITOR_CAPACITY" });
    activeBlocked.release();
    recovered.release();
    const next = other.acquire("next", callbacks);
    await next.ready;
    next.release();
  }
});

it("releases a reserved slot after failed reads and shares it during concurrent acquisition", async () => {
  const { callbacks } = fixture();
  const capacity = new TextEditorCapacity(1, 2 * 1024 * 1024);
  const cache = new TextEditorSessionCache({}, 16, 64 * 1024 * 1024, capacity);
  callbacks.read.mockRejectedValueOnce(new Error("read failed"));
  const failed = cache.acquire("a", callbacks);
  await expect(failed.ready).rejects.toThrow("read failed");
  failed.release();
  const first = cache.acquire("b", callbacks);
  const second = cache.acquire("b", callbacks);
  expect(await first.ready).toBe(await second.ready);
  first.release();
  second.release();
});
