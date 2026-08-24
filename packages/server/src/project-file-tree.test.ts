import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readProjectFileTree } from "./project-file-tree.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryProject() {
  const projectRoot = await mkdtemp(join(tmpdir(), "code-agent-tree-"));
  temporaryDirectories.push(projectRoot);
  return projectRoot;
}

describe("readProjectFileTree", () => {
  it("lists files and directories matched by gitignore rules", async () => {
    const projectRoot = await createTemporaryProject();
    await mkdir(join(projectRoot, "ignored-directory"));
    await Promise.all([
      writeFile(join(projectRoot, ".gitignore"), "ignored-directory/\n*.log\n"),
      writeFile(join(projectRoot, "ignored-directory", "secret.txt"), "secret\n"),
      writeFile(join(projectRoot, "debug.log"), "debug\n"),
    ]);

    await expect(readProjectFileTree(projectRoot)).resolves.toEqual({
      entries: [
        { path: "ignored-directory", type: "directory" },
        { path: ".gitignore", type: "file" },
        { path: "debug.log", type: "file" },
      ],
      path: null,
    });
    await expect(readProjectFileTree(projectRoot, "ignored-directory")).resolves.toEqual({
      entries: [{ path: "ignored-directory/secret.txt", type: "file" }],
      path: "ignored-directory",
    });
  });

  it("lists entries matched by nested gitignore rules outside a Git repository", async () => {
    const projectRoot = await createTemporaryProject();
    await mkdir(join(projectRoot, "packages", "client", "generated"), { recursive: true });
    await Promise.all([
      writeFile(join(projectRoot, "README.md"), "# Project\n"),
      writeFile(join(projectRoot, "debug.log"), "root debug\n"),
      writeFile(join(projectRoot, "packages", "client", ".gitignore"), "generated/\n*.log\n"),
      writeFile(join(projectRoot, "packages", "client", "debug.log"), "debug\n"),
      writeFile(join(projectRoot, "packages", "client", "generated", "client.ts"), "export {};\n"),
      writeFile(join(projectRoot, "packages", "client", "visible.ts"), "export {};\n"),
    ]);

    await expect(readProjectFileTree(projectRoot)).resolves.toEqual({
      entries: [
        { path: "packages", type: "directory" },
        { path: "debug.log", type: "file" },
        { path: "README.md", type: "file" },
      ],
      path: null,
    });
    await expect(readProjectFileTree(projectRoot, "packages/client")).resolves.toEqual({
      entries: [
        { path: "packages/client/generated", type: "directory" },
        { path: "packages/client/.gitignore", type: "file" },
        { path: "packages/client/debug.log", type: "file" },
        { path: "packages/client/visible.ts", type: "file" },
      ],
      path: "packages/client",
    });
  });

  it("returns a stable project-relative tree without generated directories or symbolic links", async () => {
    const projectRoot = await createTemporaryProject();
    const outsideRoot = await mkdtemp(join(tmpdir(), "code-agent-tree-outside-"));
    temporaryDirectories.push(outsideRoot);
    await Promise.all([
      mkdir(join(projectRoot, ".git")),
      mkdir(join(projectRoot, "node_modules")),
      mkdir(join(projectRoot, "src", "components"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(projectRoot, ".DS_Store"), "finder metadata"),
      writeFile(join(projectRoot, "README.md"), "# Project\n"),
      writeFile(join(projectRoot, "src", "main.tsx"), "export {};\n"),
      writeFile(join(projectRoot, "src", "components", "button.tsx"), "export {};\n"),
      writeFile(join(outsideRoot, "secret.txt"), "secret\n"),
    ]);
    await symlink(outsideRoot, join(projectRoot, "linked-outside"));

    await expect(readProjectFileTree(projectRoot)).resolves.toEqual({
      entries: [
        { path: "src", type: "directory" },
        { path: "README.md", type: "file" },
      ],
      path: null,
    });
    await expect(readProjectFileTree(projectRoot, "linked-outside")).rejects.toThrow();
    await expect(readProjectFileTree(projectRoot, "../outside")).rejects.toThrow();
  });

  it("returns every direct child without an entry limit", async () => {
    const projectRoot = await createTemporaryProject();
    await Promise.all(
      Array.from({ length: 2_001 }, (_, index) =>
        writeFile(join(projectRoot, `file-${String(index).padStart(4, "0")}.txt`), ""),
      ),
    );

    const tree = await readProjectFileTree(projectRoot);

    expect(tree.entries).toHaveLength(2_001);
    expect(tree.path).toBeNull();
  });
});
