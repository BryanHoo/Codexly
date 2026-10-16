import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { MAX_AGENT_FILE_BYTES } from "@codexly/protocol";
import { CodexPersistentHistoricalAttachmentStore } from "./persistent-historical-attachment-store.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "codexly-persistent-attachment-"));
  directories.push(directory);
  return {
    directory,
    store: new CodexPersistentHistoricalAttachmentStore(join(directory, "blobs")),
  };
}

test("persists a 50 MiB file without completing on the calling event-loop turn", async () => {
  const { directory, store } = await setup();
  const path = join(directory, "large.bin");
  const bytes = Buffer.alloc(MAX_AGENT_FILE_BYTES, 0x5a);
  await writeFile(path, bytes);
  const pending = store.addLocalFile("task", {
    path,
    name: "large.bin",
    mediaType: "application/octet-stream",
  });
  // 返回前不能完成大文件读取、哈希和写盘，其他会话必须有机会继续处理事件。
  expect(pending).toBeInstanceOf(Promise);
  expect(store.pendingMetadata("task")).toEqual([]);
  const attachment = await pending;
  expect(attachment?.size).toBe(MAX_AGENT_FILE_BYTES);
  const [metadata] = store.pendingMetadata("task");
  expect(metadata?.blobKey).toBe(createHash("sha256").update(bytes).digest("hex"));
  const download = store.read("task", attachment?.id ?? "");
  let yielded = false;
  await new Promise<void>((resolve) =>
    setImmediate(() => {
      yielded = true;
      resolve();
    }),
  );
  expect(yielded).toBe(true);
  const downloaded = await download;
  expect(downloaded === undefined ? false : Buffer.from(downloaded.content).equals(bytes)).toBe(
    true,
  );
  store.dispose();
});

test("deduplicates concurrent persistence and restores the same authorization after restart", async () => {
  const { directory, store } = await setup();
  const input = { name: "notes.txt", text: "你好，历史附件" };
  const attachments = await Promise.all(
    Array.from({ length: 8 }, () => store.addText("task", input, 0)),
  );
  expect(new Set(attachments.map((attachment) => attachment?.id)).size).toBe(1);
  const metadata = store.pendingMetadata("task");
  expect(metadata).toHaveLength(1);
  const taskDirectories = await readdir(join(directory, "blobs"));
  expect(await readdir(join(directory, "blobs", taskDirectories[0] ?? ""))).toEqual([
    metadata[0]?.blobKey,
  ]);
  store.dispose();
  const restored = new CodexPersistentHistoricalAttachmentStore(join(directory, "blobs"));
  await restored.restoreTask("task", metadata);
  await expect(restored.read("other-task", attachments[0]?.id ?? "")).resolves.toBeUndefined();
  await expect(restored.read("task", attachments[0]?.id ?? "")).resolves.toMatchObject({
    content: Buffer.from(input.text),
  });
  restored.dispose();
});

test("rejects forged staged digests and cleans partial files without deleting the source", async () => {
  const { directory, store } = await setup();
  const path = join(directory, "staged.png");
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await writeFile(path, bytes);
  await expect(
    Promise.resolve(
      store.addStagedImage(
        "task",
        { path, contentDigest: "0".repeat(64), mediaType: "image/png", size: bytes.length },
        0,
      ),
    ),
  ).resolves.toBeUndefined();
  expect(await readFile(path)).toEqual(bytes);
  expect(store.pendingMetadata("task")).toEqual([]);
  store.dispose();
});

test("revokes a corrupted blob and removes it asynchronously", async () => {
  const { directory, store } = await setup();
  const attachment = await store.addText("task", { name: "test.txt", text: "original" }, 0);
  const metadata = store.pendingMetadata("task")[0];
  const path = join(
    directory,
    "blobs",
    createHash("sha256").update("task").digest("hex"),
    metadata?.blobKey ?? "",
  );
  await writeFile(path, "tampered");
  await expect(store.read("task", attachment?.id ?? "")).resolves.toBeUndefined();
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  store.dispose();
});

test("does not authorize a late write after disposal", async () => {
  const { store } = await setup();
  const pending = store.addText("task", { name: "notes.txt", text: "hello" }, 0);
  store.dispose();
  await expect(pending).resolves.toBeUndefined();
  expect(store.pendingMetadata("task")).toEqual([]);
});

test("waits for pending writes before removing a deleted task's directory", async () => {
  const { directory, store } = await setup();
  const pending = store.addText("task", { name: "notes.txt", text: "hello" }, 0);
  store.deleteTask("task");
  await expect(pending).resolves.toBeUndefined();
  await vi.waitFor(async () => {
    await expect(
      readdir(join(directory, "blobs", createHash("sha256").update("task").digest("hex"))),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  expect(store.pendingMetadata("task")).toEqual([]);
  store.dispose();
});

test("validates staged images, removes staging files and rejects invalid inputs", async () => {
  const { directory, store } = await setup();
  const path = join(directory, "staged.png");
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await writeFile(path, bytes);
  const attachment = await store.addStagedImage(
    "task",
    {
      path,
      contentDigest: createHash("sha256").update(bytes).digest("hex"),
      mediaType: "image/png",
      size: bytes.length,
    },
    0,
  );
  expect(attachment?.mediaType).toBe("image/png");
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    Buffer.from((await store.read("task", attachment?.id ?? ""))?.content ?? []).equals(bytes),
  ).toBe(true);
  await expect(
    store.addLocalFile("task", {
      path: "relative",
      name: "bad.bin",
      mediaType: "application/octet-stream",
    }),
  ).resolves.toBeUndefined();
  await expect(store.addBase64Image("task", { encoded: "=" }, 0)).resolves.toBeUndefined();
  store.dispose();
});

test("does not restore later references after a task is cleared during recovery", async () => {
  const { store } = await setup();
  await store.addText("task", { name: "first.txt", text: "first" }, 0);
  const second = await store.addText("task", { name: "second.txt", text: "second" }, 1);
  const pending = store.restoreTask("task", store.pendingMetadata("task"));
  store.clearTask("task");
  await pending;
  expect(await store.read("task", second?.id ?? "")).toBeUndefined();
  store.dispose();
});
