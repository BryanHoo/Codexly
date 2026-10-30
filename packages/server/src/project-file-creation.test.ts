import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createProjectFile } from "./project-file-mutations.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codexly-create-")));
  roots.push(root);
  return root;
}

describe("createProjectFile", () => {
  it("creates empty files and directories in root and nested folders", async () => {
    const root = await fixture();
    await expect(
      createProjectFile(root, { parentPath: null, name: "中文目录", type: "directory" }),
    ).resolves.toEqual({ path: "中文目录" });
    await expect(
      createProjectFile(root, { parentPath: "中文目录", name: "新文件.txt", type: "file" }),
    ).resolves.toEqual({ path: "中文目录/新文件.txt" });
    expect(await readFile(join(root, "中文目录/新文件.txt"), "utf8")).toBe("");
  });

  it("never overwrites existing content or accepts an existing directory", async () => {
    const root = await fixture();
    await writeFile(join(root, "saved.txt"), "preserved");
    await mkdir(join(root, "folder"));
    for (const name of ["saved.txt", "folder"]) {
      for (const type of ["file", "directory"] as const) {
        await expect(createProjectFile(root, { parentPath: null, name, type })).rejects.toThrow(
          "already exists",
        );
      }
    }
    expect(await readFile(join(root, "saved.txt"), "utf8")).toBe("preserved");
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        createProjectFile(root, { parentPath: null, name: "race.txt", type: "file" }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it.each([
    "",
    ".",
    "..",
    "a/b",
    "a\\b",
    "bad\0name",
    "bad\nname",
    "CON",
    "nul.txt",
    "bad.",
    "bad:",
    "a".repeat(256),
  ])("rejects invalid portable names: %j", async (name) => {
    const root = await fixture();
    await expect(
      createProjectFile(root, { parentPath: null, name, type: "file" }),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects traversal and symlink escapes without writing outside the root", async () => {
    const root = await fixture();
    const outside = await fixture();
    await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    for (const parentPath of [
      "..",
      "../other",
      outside,
      "linked",
      "missing",
      "a/../b",
      "C:/Windows",
      "a\\b",
    ]) {
      await expect(
        createProjectFile(root, { parentPath, name: "escaped.txt", type: "file" }),
      ).rejects.toThrow();
    }
    expect(await readdir(outside)).toEqual([]);
  });
});
