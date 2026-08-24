import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { AttachmentNotFoundError, AttachmentStore } from "./attachment-store.js";

const pixelDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const pastedTextDataUrl = "data:text/plain;base64,5L2g5aW9IENvZGVBZ2VudA==";
const pdfDataUrl = "data:application/pdf;base64,JVBERi0xLjQ=";

function uploadInput(dataUrl: string, kind: "file" | "image" | "text", name: string) {
  const [header, encoded = ""] = dataUrl.split(",");
  return {
    content: Readable.from(Buffer.from(encoded, "base64")),
    kind,
    mediaType: header?.slice(5, -7) ?? "",
    name,
  };
}

describe("AttachmentStore", () => {
  it("streams validated image data to disk behind an opaque reference", async () => {
    const store = new AttachmentStore({ createId: () => "attachment-1" });

    const { attachment } = await store.add(
      "code-agent",
      uploadInput(pixelDataUrl, "image", "screen.png"),
    );

    expect(attachment).toEqual({
      id: "attachment-1",
      kind: "image",
      mediaType: "image/png",
      name: "screen.png",
      size: 68,
    });
    await expect(store.read("code-agent", attachment.id)).resolves.toEqual({
      attachment,
      content: Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64"),
    });
    await expect(store.resolve("code-agent", [attachment.id])).resolves.toEqual([
      { kind: "image", mediaType: "image/png", size: 68, url: pixelDataUrl },
    ]);
    await expect(store.read("other", attachment.id)).rejects.toThrow(AttachmentNotFoundError);
    await expect(store.resolve("other", [attachment.id])).rejects.toThrow(AttachmentNotFoundError);
  });

  it("stores pasted UTF-8 text as a bounded text attachment", async () => {
    const store = new AttachmentStore({ createId: () => "attachment-text" });

    const { attachment } = await store.add(
      "code-agent",
      uploadInput(pastedTextDataUrl, "text", "Pasted text.txt"),
    );

    expect(attachment).toEqual({
      id: "attachment-text",
      kind: "text",
      mediaType: "text/plain",
      name: "Pasted text.txt",
      size: 16,
    });
    await expect(store.resolve("code-agent", [attachment.id])).resolves.toEqual([
      {
        mediaType: "text/plain",
        kind: "text",
        name: "Pasted text.txt",
        size: 16,
        text: "你好 CodeAgent",
      },
    ]);
  });

  it("materializes supported files for Codex mention inputs", async () => {
    const store = new AttachmentStore({
      attachmentDirectory: join(tmpdir(), `code-agent-attachment-test-${crypto.randomUUID()}`),
      createId: () => "attachment-file",
    });

    const { attachment } = await store.add(
      "code-agent",
      uploadInput(pdfDataUrl, "file", "specification.pdf"),
    );
    const [resolved] = await store.resolve("code-agent", [attachment.id]);

    expect(attachment).toMatchObject({
      kind: "file",
      mediaType: "application/pdf",
      name: "specification.pdf",
      size: 8,
    });
    expect(resolved).toMatchObject({
      kind: "file",
      mediaType: "application/pdf",
      name: "specification.pdf",
    });
    if (resolved?.kind !== "file") {
      throw new Error("Expected a materialized file attachment");
    }
    expect(existsSync(resolved.path)).toBe(true);
    expect(readFileSync(resolved.path, "utf8")).toBe("%PDF-1.4");

    await store.consume("code-agent", [attachment.id], "turn-file");
    await expect(store.resolve("code-agent", [attachment.id])).rejects.toThrow(
      AttachmentNotFoundError,
    );
    await store.releaseTurn("other-project", "turn-file");
    expect(existsSync(resolved.path)).toBe(true);
    await store.releaseTurn("code-agent", "turn-file");
    expect(existsSync(resolved.path)).toBe(false);

    await store.dispose();
    expect(existsSync(resolved.path)).toBe(false);
  });

  it("expires, consumes, and clears stored attachments", async () => {
    let now = 1_000;
    let nextId = 1;
    const store = new AttachmentStore({
      clock: () => now,
      createId: () => `attachment-${String(nextId++)}`,
      ttlMs: 100,
    });
    const { attachment: expired } = await store.add(
      "code-agent",
      uploadInput(pixelDataUrl, "image", "expired.png"),
    );
    now = 1_101;

    await expect(store.resolve("code-agent", [expired.id])).rejects.toThrow(
      AttachmentNotFoundError,
    );

    const { attachment: consumed } = await store.add(
      "code-agent",
      uploadInput(pixelDataUrl, "image", "consumed.png"),
    );
    await expect(store.resolve("code-agent", [consumed.id])).resolves.toHaveLength(1);
    await store.consume("code-agent", [consumed.id]);
    await expect(store.resolve("code-agent", [consumed.id])).rejects.toThrow(
      AttachmentNotFoundError,
    );

    const { attachment: cleared } = await store.add(
      "code-agent",
      uploadInput(pixelDataUrl, "image", "cleared.png"),
    );
    await store.clear();
    await expect(store.resolve("code-agent", [cleared.id])).rejects.toThrow(
      AttachmentNotFoundError,
    );
  });

  it("retains queued attachments until delete or transfers them to a started turn", async () => {
    let nextId = 1;
    const store = new AttachmentStore({ createId: () => `attachment-${String(nextId++)}` });
    const first = await store.add(
      "code-agent",
      uploadInput(pastedTextDataUrl, "text", "queued.txt"),
    );
    await store.retainQueue("code-agent", [first.attachment.id], "queue-1");
    await expect(store.resolve("code-agent", [first.attachment.id])).resolves.toHaveLength(1);
    await store.startQueue("code-agent", "queue-1", "turn-queued");
    await expect(store.resolve("code-agent", [first.attachment.id])).rejects.toThrow(
      AttachmentNotFoundError,
    );
    await store.releaseTurn("code-agent", "turn-queued");

    const second = await store.add(
      "code-agent",
      uploadInput(pastedTextDataUrl, "text", "delete.txt"),
    );
    await store.retainQueue("code-agent", [second.attachment.id], "queue-2");
    await store.releaseQueue("code-agent", "queue-2");
    await expect(store.resolve("code-agent", [second.attachment.id])).rejects.toThrow(
      AttachmentNotFoundError,
    );
  });

  it("keeps native queue attachments past TTL and expires them after queue reconciliation", async () => {
    let now = 0;
    let nextId = 1;
    const store = new AttachmentStore({
      clock: () => now,
      createId: () => `attachment-${String(nextId++)}`,
      ttlMs: 10,
    });
    const queued = await store.add(
      "code-agent",
      uploadInput(pastedTextDataUrl, "text", "queued.txt"),
    );
    await store.retainQueue("code-agent", [queued.attachment.id], "queue-1");

    now = 20;
    await store.add("code-agent", uploadInput(pastedTextDataUrl, "text", "trigger.txt"));
    await store.releaseProjectRuntime("code-agent");
    await expect(store.resolve("code-agent", [queued.attachment.id])).resolves.toHaveLength(1);

    store.reconcileQueue("code-agent", []);
    now = 40;
    await store.add("code-agent", uploadInput(pastedTextDataUrl, "text", "prune.txt"));
    await expect(store.resolve("code-agent", [queued.attachment.id])).rejects.toThrow(
      AttachmentNotFoundError,
    );
  });

  it("releases only attachments owned by the removed project", async () => {
    let nextId = 1;
    const store = new AttachmentStore({ createId: () => `attachment-${String(nextId++)}` });
    const first = await store.add("project-1", uploadInput(pixelDataUrl, "image", "first.png"));
    const second = await store.add("project-2", uploadInput(pixelDataUrl, "image", "second.png"));

    await store.releaseProject("project-1");

    await expect(store.resolve("project-1", [first.attachment.id])).rejects.toThrow(
      AttachmentNotFoundError,
    );
    await expect(store.resolve("project-2", [second.attachment.id])).resolves.toHaveLength(1);
    await store.dispose();
  });

  it("enforces decoded byte and total capacity limits", async () => {
    const store = new AttachmentStore({
      createId: () => globalThis.crypto.randomUUID(),
      maxBytes: 68,
      maxEntries: 1,
      maxTotalBytes: 68,
    });
    await store.add("code-agent", uploadInput(pixelDataUrl, "image", "first.png"));

    await expect(
      store.add("code-agent", uploadInput(pixelDataUrl, "image", "second.png")),
    ).rejects.toThrow("Attachment store capacity exceeded");
    await expect(
      new AttachmentStore({ maxBytes: 67 }).add(
        "code-agent",
        uploadInput(pixelDataUrl, "image", "large.png"),
      ),
    ).rejects.toThrow("Attachment exceeds the maximum size");
  });

  it("enforces entry and byte capacities across concurrent uploads", async () => {
    const createStore = (limits: { maxEntries: number; maxTotalBytes: number }) => {
      let nextId = 1;
      return new AttachmentStore({
        ...limits,
        createId: () => `concurrent-${String(nextId++)}`,
      });
    };
    const uploadConcurrently = async (store: AttachmentStore) =>
      Promise.allSettled([
        store.add("code-agent", uploadInput(pixelDataUrl, "image", "first.png")),
        store.add("code-agent", uploadInput(pixelDataUrl, "image", "second.png")),
      ]);
    const expectOneCapacityRejection = (
      results: readonly PromiseSettledResult<unknown>[],
    ): void => {
      expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
      const rejected = results.find(({ status }) => status === "rejected");
      const reason: unknown = rejected?.status === "rejected" ? rejected.reason : undefined;
      expect(reason).toBeInstanceOf(RangeError);
      expect(reason).toMatchObject({ message: "Attachment store capacity exceeded" });
    };

    const entryLimitedStore = createStore({ maxEntries: 1, maxTotalBytes: 136 });
    const entryResults = await uploadConcurrently(entryLimitedStore);
    expectOneCapacityRejection(entryResults);
    await entryLimitedStore.clear();
    await expect(
      entryLimitedStore.add("code-agent", uploadInput(pixelDataUrl, "image", "after-clear.png")),
    ).resolves.toBeDefined();
    await entryLimitedStore.dispose();

    const byteLimitedStore = createStore({ maxEntries: 2, maxTotalBytes: 68 });
    const byteResults = await uploadConcurrently(byteLimitedStore);
    expectOneCapacityRejection(byteResults);
    await byteLimitedStore.dispose();
  });

  it("stops streaming an attachment as soon as its byte limit is exceeded", async () => {
    const store = new AttachmentStore({ maxBytes: 2 });

    await expect(
      store.add("code-agent", {
        content: Readable.from([Buffer.from([0x89, 0x50, 0x4e])]),
        kind: "image",
        mediaType: "image/png",
        name: "large.png",
      }),
    ).rejects.toThrow("Attachment exceeds the maximum size");
  });
});
