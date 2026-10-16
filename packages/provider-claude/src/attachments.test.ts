import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { ClaudeAttachments } from "./attachments.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "claude-attachments-"));
  roots.push(root);
  return { root, store: new ClaudeAttachments(root) };
}
const input = {
  text: "",
  files: [],
  images: [],
  skills: [],
  textAttachments: [{ name: "proof.txt", text: "proof" }],
};

it("keeps stable identities and one blob when a restarted provider sends the same attachment", async () => {
  const { root, store } = await setup();
  const first = await store.prepare("task", input);
  const fresh = new ClaudeAttachments(root);
  expect(await fresh.prepare("task", input)).toEqual(first);
  const [taskDirectory] = await readdir(join(root, "blobs"));
  assert(taskDirectory);
  assert(first[0]);
  expect(await readdir(join(root, "blobs", taskDirectory))).toHaveLength(1);
  const other = await fresh.prepare("other-task", input);
  expect(other[0]?.id).not.toBe(first[0].id);
  expect(await fresh.read("other-task", first[0].id)).toBeUndefined();
});

it("rejects unavailable storage and missing inputs instead of silently sending unrecorded attachments", async () => {
  const { root } = await setup();
  const blocked = join(root, "blocked");
  await writeFile(blocked, "not a directory");
  await expect(new ClaudeAttachments(blocked).prepare("task", input)).rejects.toThrow(
    "附件保存失败",
  );
  await expect(
    new ClaudeAttachments(root).prepare("task", {
      ...input,
      files: [
        { name: "missing.pdf", mediaType: "application/pdf", path: join(root, "missing.pdf") },
      ],
    }),
  ).rejects.toThrow("附件保存失败");
});

it("rejects corrupted blobs and removes deleted task references", async () => {
  const { root, store } = await setup();
  const [attachment] = await store.prepare("task", input);
  const [taskDirectory] = await readdir(join(root, "blobs"));
  assert(taskDirectory);
  assert(attachment);
  const directory = join(root, "blobs", taskDirectory);
  const [blob] = await readdir(directory);
  assert(blob);
  await writeFile(join(directory, blob), "wrong");
  expect(await new ClaudeAttachments(root).read("task", attachment.id)).toBeUndefined();
  await store.deleteTask("task");
  expect(await new ClaudeAttachments(root).read("task", attachment.id)).toBeUndefined();
});
