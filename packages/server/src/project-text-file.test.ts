import { mkdtemp, readFile, rm, writeFile, symlink, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as textFiles from "./project-text-file.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(content: string | Buffer = "\uFEFF第一行\r\n第二行\r\n") {
  const root = await mkdtemp(join(tmpdir(), "codexly-edit-"));
  roots.push(root);
  await writeFile(join(root, "notes.md"), content);
  return root;
}
it("preserves UTF-8 BOM, CRLF and permissions on atomic save", async () => {
  const root = await fixture();
  await chmod(join(root, "notes.md"), 0o640);
  const original = await textFiles.readProjectTextFile(root, "notes.md");
  expect(original.content).toBe("\uFEFF第一行\r\n第二行\r\n");
  const content = original.content.replace("第二行", "修改");
  const saved = await textFiles.saveProjectTextFile(root, {
    path: "notes.md",
    content,
    expectedVersion: original.version,
  });
  expect(saved.version).not.toBe(original.version);
  expect(await readFile(join(root, "notes.md"), "utf8")).toBe(content);
  if (process.platform !== "win32")
    expect((await stat(join(root, "notes.md"))).mode & 0o777).toBe(0o640);
});
it("rejects stale and concurrent writers without losing the winner", async () => {
  const root = await fixture("original");
  const original = await textFiles.readProjectTextFile(root, "notes.md");
  const results = await Promise.allSettled(
    ["one", "two"].map((content) =>
      textFiles.saveProjectTextFile(root, {
        path: "notes.md",
        content,
        expectedVersion: original.version,
      }),
    ),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  await expect(
    textFiles.saveProjectTextFile(root, {
      path: "notes.md",
      content: "stale",
      expectedVersion: original.version,
    }),
  ).rejects.toMatchObject({ code: "TEXT_FILE_CONFLICT" });
  expect(["one", "two"]).toContain(await readFile(join(root, "notes.md"), "utf8"));
});
it("rejects external changes and does not recreate a deleted file", async () => {
  const root = await fixture("original");
  const original = await textFiles.readProjectTextFile(root, "notes.md");
  await writeFile(join(root, "notes.md"), "external");
  await expect(
    textFiles.saveProjectTextFile(root, {
      path: "notes.md",
      content: "mine",
      expectedVersion: original.version,
    }),
  ).rejects.toMatchObject({ code: "TEXT_FILE_CONFLICT" });
  await rm(join(root, "notes.md"));
  await expect(
    textFiles.saveProjectTextFile(root, {
      path: "notes.md",
      content: "mine",
      expectedVersion: original.version,
    }),
  ).rejects.toThrow();
});
it("bounds reads and writes and rejects binary, non-UTF8, mixed line endings and office files", async () => {
  for (const content of [
    Buffer.from([0xff]),
    Buffer.from([0, 1]),
    "a\r\nb\n",
    "x".repeat(2 * 1024 * 1024 + 1),
  ]) {
    const root = await fixture(content);
    await expect(textFiles.readProjectTextFile(root, "notes.md")).rejects.toThrow();
  }
  const root = await fixture("ok");
  await writeFile(join(root, "fake.docx"), "plain text");
  await expect(textFiles.readProjectTextFile(root, "fake.docx")).rejects.toThrow();
  const original = await textFiles.readProjectTextFile(root, "notes.md");
  await expect(
    textFiles.saveProjectTextFile(root, {
      path: "notes.md",
      content: "x".repeat(2 * 1024 * 1024 + 1),
      expectedVersion: original.version,
    }),
  ).rejects.toThrow();
  expect(await readFile(join(root, "notes.md"), "utf8")).toBe("ok");
});
it("rejects traversal and symlinks, including absolute paths outside the root", async () => {
  const root = await fixture();
  const outside = await fixture("secret");
  for (const path of ["../notes.md", join(outside, "notes.md"), ".git/config"]) {
    await expect(textFiles.readProjectTextFile(root, path)).rejects.toThrow();
  }
  await symlink(join(outside, "notes.md"), join(root, "linked.md"));
  await expect(textFiles.readProjectTextFile(root, "linked.md")).rejects.toThrow();
  expect((await textFiles.readProjectTextFile(root, join(root, "notes.md"))).path).toBe("notes.md");
});
