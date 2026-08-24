import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexHistoricalAttachmentStore } from "./historical-attachment-store.js";

const pngContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngDataUrl = `data:image/png;base64,${pngContent.toString("base64")}`;
const stores: CodexHistoricalAttachmentStore[] = [];

function createStore(
  options: ConstructorParameters<typeof CodexHistoricalAttachmentStore>[0] = {},
): Readonly<{ directory: string; store: CodexHistoricalAttachmentStore }> {
  const directory = mkdtempSync(join(tmpdir(), "code-agent-history-test-"));
  const store = new CodexHistoricalAttachmentStore({ attachmentDirectory: directory, ...options });
  stores.push(store);
  return { directory, store };
}

afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) {
    store.dispose();
  }
});

describe("CodexHistoricalAttachmentStore", () => {
  it("registers inline images as random metadata without exposing their data URL", async () => {
    const diskRead = vi.fn((path: string) => readFile(path));
    const { directory, store } = createStore({
      createId: () => "history-random-1",
      readFile: diskRead,
    });

    const attachment = store.addDataUrl("task-1", { name: "diagram.png", url: pngDataUrl }, 0);

    expect(attachment).toEqual({
      id: "history-random-1",
      kind: "image",
      mediaType: "image/png",
      name: "diagram.png",
      size: pngContent.byteLength,
    });
    expect(attachment).not.toHaveProperty("url");
    expect(readdirSync(directory)).toHaveLength(1);
    await expect(store.read("task-other", "history-random-1")).resolves.toBeUndefined();
    await expect(store.read("task-1", "history-random-1")).resolves.toMatchObject({
      content: pngContent,
      mediaType: "image/png",
      name: "diagram.png",
      size: pngContent.byteLength,
    });
    expect(diskRead).toHaveBeenCalledOnce();
  });

  it("defers local image body reads and revalidates the file asynchronously on demand", async () => {
    let completeRead: ((content: Buffer) => void) | undefined;
    const readFile = vi.fn(
      () =>
        new Promise<Buffer>((resolve) => {
          completeRead = resolve;
        }),
    );
    const store = new CodexHistoricalAttachmentStore({
      createId: () => "history-local-1",
      readFile,
      readHeader: () => pngContent,
      readStats: () => Promise.resolve({ isFile: true, mtimeMs: 100, size: pngContent.byteLength }),
      statFile: () => ({ isFile: true, mtimeMs: 100, size: pngContent.byteLength }),
    });

    const attachment = store.addLocalImage("task-1", "/private/diagram.png", 0);

    expect(attachment).toEqual({
      id: "history-local-1",
      kind: "image",
      mediaType: "image/png",
      name: "diagram.png",
      size: pngContent.byteLength,
    });
    expect(readFile).not.toHaveBeenCalled();
    const pendingRead = store.read("task-1", "history-local-1");
    await Promise.resolve();
    expect(readFile).toHaveBeenCalledOnce();
    let settled = false;
    void pendingRead.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    completeRead?.(pngContent);
    await expect(pendingRead).resolves.toMatchObject({ content: pngContent });
  });

  it("adopts worker-staged images without decoding or rewriting their body", async () => {
    const stagingDirectory = mkdtempSync(join(tmpdir(), "code-agent-history-staged-"));
    const stagedPath = join(stagingDirectory, "generated.png");
    writeFileSync(stagedPath, pngContent);
    const { directory, store } = createStore({ createId: () => "history-staged-1" });

    const attachment = store.addStagedImage(
      "task-1",
      {
        contentDigest: createHash("sha256").update(pngContent).digest("hex"),
        mediaType: "image/png",
        path: stagedPath,
        size: pngContent.byteLength,
      },
      0,
    );

    expect(attachment).toMatchObject({
      id: "history-staged-1",
      mediaType: "image/png",
      name: "生成图片-1.png",
      size: pngContent.byteLength,
    });
    expect(existsSync(stagedPath)).toBe(false);
    expect(readdirSync(directory)).toHaveLength(1);
    await expect(store.read("task-1", attachment?.id ?? "")).resolves.toMatchObject({
      content: pngContent,
    });
    rmSync(stagingDirectory, { force: true, recursive: true });
  });

  it("rejects local images changed after registration", async () => {
    let mtimeMs = 100;
    const readFile = vi.fn(() => pngContent);
    const changedMetadataStore = new CodexHistoricalAttachmentStore({
      createId: () => "history-local-metadata",
      readFile: () => Promise.resolve(readFile()),
      readHeader: () => pngContent,
      readStats: () => Promise.resolve({ isFile: true, mtimeMs, size: pngContent.byteLength }),
      statFile: () => ({ isFile: true, mtimeMs: 100, size: pngContent.byteLength }),
    });
    const metadataAttachment = changedMetadataStore.addLocalImage(
      "task-1",
      "/private/diagram.png",
      0,
    );

    mtimeMs = 101;
    await expect(
      changedMetadataStore.read("task-1", metadataAttachment?.id ?? ""),
    ).resolves.toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();

    const changedContentStore = new CodexHistoricalAttachmentStore({
      createId: () => "history-local-content",
      readFile: () => Promise.resolve(Buffer.from("not-png!")),
      readHeader: () => pngContent,
      readStats: () => Promise.resolve({ isFile: true, mtimeMs: 100, size: pngContent.byteLength }),
      statFile: () => ({ isFile: true, mtimeMs: 100, size: pngContent.byteLength }),
    });
    const contentAttachment = changedContentStore.addLocalImage(
      "task-1",
      "/private/diagram.png",
      0,
    );

    await expect(
      changedContentStore.read("task-1", contentAttachment?.id ?? ""),
    ).resolves.toBeUndefined();
  });

  it("evicts the least recently used entries by entry and byte budgets", async () => {
    const now = 100;
    let nextId = 0;
    const { store } = createStore({
      clock: () => now,
      createId: () => `history-${String(++nextId)}`,
      maxEntries: 2,
      maxTotalBytes: pngContent.byteLength * 2,
      ttlMs: 50,
    });

    const first = store.addDataUrl("task-1", { name: "first.png", url: pngDataUrl }, 0);
    const second = store.addDataUrl("task-1", { name: "second.png", url: pngDataUrl }, 1);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    await expect(store.read("task-1", first?.id ?? "")).resolves.toBeDefined();
    const third = store.addDataUrl("task-1", { name: "third.png", url: pngDataUrl }, 2);

    expect(third).toBeDefined();
    await expect(store.read("task-1", second?.id ?? "")).resolves.toBeUndefined();
    await expect(store.read("task-1", first?.id ?? "")).resolves.toBeDefined();
    await expect(store.read("task-1", third?.id ?? "")).resolves.toBeDefined();
    store.clearTask("task-1");
    await expect(store.read("task-1", first?.id ?? "")).resolves.toBeUndefined();
  });

  it("periodically deletes expired managed files while idle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const { directory, store } = createStore({ cleanupIntervalMs: 10, ttlMs: 50 });

    const expiring = store.addDataUrl("task-2", { name: "expiring.png", url: pngDataUrl }, 0);
    expect(readdirSync(directory)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(50);

    expect(readdirSync(directory)).toHaveLength(0);
    await expect(store.read("task-2", expiring?.id ?? "")).resolves.toBeUndefined();
  });

  it("disposes its timer and managed directory without deleting local source files", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { directory, store } = createStore();
    const localDirectory = mkdtempSync(join(tmpdir(), "code-agent-history-local-"));
    const localPath = join(localDirectory, "source.png");
    writeFileSync(localPath, pngContent);

    store.addDataUrl("task-1", { url: pngDataUrl }, 0);
    store.addLocalImage("task-1", localPath, 1);
    store.dispose();

    expect(existsSync(directory)).toBe(false);
    expect(existsSync(localPath)).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalled();
    rmSync(localDirectory, { force: true, recursive: true });
    clearIntervalSpy.mockRestore();
  });

  it("rejects invalid signatures and images over the per-file limit", () => {
    const store = new CodexHistoricalAttachmentStore({ maxBytes: pngContent.byteLength - 1 });
    const invalidDataUrl = `data:image/png;base64,${Buffer.from("not-png").toString("base64")}`;

    expect(store.addDataUrl("task-1", { name: "large.png", url: pngDataUrl }, 0)).toBeUndefined();
    expect(
      store.addDataUrl("task-1", { name: "invalid.png", url: invalidDataUrl }, 1),
    ).toBeUndefined();
  });
});
