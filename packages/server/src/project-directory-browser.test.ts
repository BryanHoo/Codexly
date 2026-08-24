import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProjectDirectoryBrowserError,
  readProjectDirectory,
  resolveProjectDirectory,
} from "./project-directory-browser.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createTemporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "code-agent-directory-browser-"));
  temporaryDirectories.push(path);
  return realpath(path);
}

describe("project directory browser", () => {
  it("starts from the provided home directory and lists only direct real directories", async () => {
    const homePath = await createTemporaryDirectory();
    const outsidePath = await createTemporaryDirectory();
    const filesystemRoots = () => Promise.resolve([]);
    await Promise.all([
      mkdir(join(homePath, "zeta")),
      mkdir(join(homePath, "Alpha")),
      mkdir(join(homePath, ".hidden")),
      writeFile(join(homePath, "README.md"), "# ignored\n"),
      symlink(outsidePath, join(homePath, "linked-directory")),
    ]);

    await expect(readProjectDirectory(undefined, { filesystemRoots, homePath })).resolves.toEqual({
      entries: [
        { name: "Alpha", path: join(homePath, "Alpha") },
        { name: "zeta", path: join(homePath, "zeta") },
      ],
      parentPath: dirname(homePath),
      path: homePath,
      roots: [],
    });
    await expect(
      readProjectDirectory(undefined, { filesystemRoots, homePath, includeHidden: true }),
    ).resolves.toEqual({
      entries: [
        { name: ".hidden", path: join(homePath, ".hidden") },
        { name: "Alpha", path: join(homePath, "Alpha") },
        { name: "zeta", path: join(homePath, "zeta") },
      ],
      parentPath: dirname(homePath),
      path: homePath,
      roots: [],
    });
  });

  it("returns every available Windows drive for switching filesystem roots", async () => {
    const homePath = await createTemporaryDirectory();
    const filesystemRoots = () =>
      Promise.resolve([
        { name: "C:", path: "C:\\" },
        { name: "D:", path: "D:\\" },
      ]);

    await expect(
      readProjectDirectory(undefined, { filesystemRoots, homePath }),
    ).resolves.toMatchObject({
      roots: [
        { name: "C:", path: "C:\\" },
        { name: "D:", path: "D:\\" },
      ],
    });
  });

  it("normalizes a selected directory and rejects relative or non-directory paths", async () => {
    const homePath = await createTemporaryDirectory();
    const childPath = join(homePath, "child");
    const filePath = join(homePath, "file.txt");
    await mkdir(childPath);
    await writeFile(filePath, "not a directory\n");

    await expect(resolveProjectDirectory(childPath)).resolves.toBe(await realpath(childPath));
    await expect(resolveProjectDirectory("relative/project")).rejects.toBeInstanceOf(
      ProjectDirectoryBrowserError,
    );
    await expect(resolveProjectDirectory(filePath)).rejects.toMatchObject({
      reason: "invalid-directory",
    });
  });
});
