import { Readable } from "node:stream";
import { expect, it } from "vitest";
import { AttachmentStore } from "./attachment-store.js";
import { createWorkspace } from "./sqlite-state-repository.test-support.js";

it("归属副本不被普通上传 TTL 回收，等待确定结果后显式清理", async () => {
  let now = 100;
  const root = await createWorkspace();
  const store = new AttachmentStore({ attachmentDirectory: root, clock: () => now, ttlMs: 100 });
  try {
    const uploaded = await store.addOwned(
      "p",
      {
        kind: "text",
        mediaType: "text/plain",
        name: "proof.txt",
        content: Readable.from(["proof"]),
      },
      "run",
    );
    now = 201;
    expect((await store.read("p", uploaded.attachment.id)).content.toString()).toBe("proof");
    await store.discardOwned("p", "run");
  } finally {
    await store.dispose();
  }
});

it("按运行归属回收重启前缓存，不删除其他项目或普通上传", async () => {
  const root = await createWorkspace();
  const first = new AttachmentStore({ attachmentDirectory: root });
  const second = new AttachmentStore({ attachmentDirectory: root });
  const input = () => ({
    kind: "file" as const,
    mediaType: "application/octet-stream",
    name: "file",
    content: Readable.from(["proof"]),
  });
  try {
    const owned = await first.addOwned("p", input(), "run");
    const other = await first.addOwned("q", input(), "run");
    const ordinary = await first.add("p", input());
    await second.discardOwned("p", "run");
    await second.discardOwned("p", "run");
    await expect(first.read("p", owned.attachment.id)).rejects.toThrow();
    expect((await first.read("q", other.attachment.id)).content.toString()).toBe("proof");
    expect((await first.read("p", ordinary.attachment.id)).content.toString()).toBe("proof");
  } finally {
    await first.dispose();
    await second.dispose();
  }
});
