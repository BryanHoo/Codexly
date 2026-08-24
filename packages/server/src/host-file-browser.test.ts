import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HostFileBrowserError,
  readHostFileDirectory,
  resolveHostAttachment,
} from "./host-file-browser.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createTemporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "codexly-host-file-browser-"));
  temporaryDirectories.push(path);
  return realpath(path);
}

describe("host file browser", () => {
  it("lists real directories and only supported files for the requested attachment kind", async () => {
    const homePath = await createTemporaryDirectory();
    const outsidePath = await createTemporaryDirectory();
    const filesystemRoots = () => Promise.resolve([]);
    await Promise.all([
      mkdir(join(homePath, ".config")),
      mkdir(join(homePath, "zeta")),
      mkdir(join(homePath, "Alpha")),
      writeFile(join(homePath, ".hidden.png"), "hidden image bytes"),
      writeFile(join(homePath, "README.md"), "# Codexly\n"),
      writeFile(join(homePath, "screen.PNG"), "image bytes"),
      writeFile(join(homePath, "archive.zip"), "unsupported"),
      symlink(outsidePath, join(homePath, "linked-directory")),
      symlink(join(homePath, "README.md"), join(homePath, "linked-file.md")),
    ]);

    await expect(
      readHostFileDirectory("image", undefined, { filesystemRoots, homePath }),
    ).resolves.toEqual({
      entries: [
        { name: "Alpha", path: join(homePath, "Alpha"), type: "directory" },
        { name: "zeta", path: join(homePath, "zeta"), type: "directory" },
        { name: "screen.PNG", path: join(homePath, "screen.PNG"), type: "file" },
      ],
      parentPath: dirname(homePath),
      path: homePath,
      roots: [],
    });
    await expect(readHostFileDirectory("file", homePath)).resolves.toMatchObject({
      entries: [
        { name: "Alpha", type: "directory" },
        { name: "zeta", type: "directory" },
        { name: "README.md", type: "file" },
      ],
    });
    await expect(
      readHostFileDirectory("image", homePath, { includeHidden: true }),
    ).resolves.toMatchObject({
      entries: [
        { name: ".config", type: "directory" },
        { name: "Alpha", type: "directory" },
        { name: "zeta", type: "directory" },
        { name: ".hidden.png", type: "file" },
        { name: "screen.PNG", type: "file" },
      ],
    });
  });

  it("returns every available Windows drive for attachment browsing", async () => {
    const homePath = await createTemporaryDirectory();
    const filesystemRoots = () =>
      Promise.resolve([
        { name: "C:", path: "C:\\" },
        { name: "D:", path: "D:\\" },
      ]);

    await expect(
      readHostFileDirectory("file", undefined, { filesystemRoots, homePath }),
    ).resolves.toMatchObject({
      roots: [
        { name: "C:", path: "C:\\" },
        { name: "D:", path: "D:\\" },
      ],
    });
  });

  it("resolves supported ordinary files and rejects unsupported or symbolic-link targets", async () => {
    const homePath = await createTemporaryDirectory();
    const imagePath = join(homePath, "screen.png");
    const unsupportedPath = join(homePath, "archive.zip");
    const linkedPath = join(homePath, "linked.png");
    await writeFile(imagePath, "image bytes");
    await writeFile(unsupportedPath, "archive bytes");
    await symlink(imagePath, linkedPath);

    await expect(resolveHostAttachment("image", imagePath)).resolves.toMatchObject({
      kind: "image",
      mediaType: "image/png",
      name: "screen.png",
    });
    await expect(resolveHostAttachment("file", unsupportedPath)).rejects.toMatchObject({
      reason: "unsupported-file",
    });
    await expect(resolveHostAttachment("image", linkedPath)).rejects.toBeInstanceOf(
      HostFileBrowserError,
    );
    await expect(resolveHostAttachment("file", "relative/README.md")).rejects.toMatchObject({
      reason: "invalid-file",
    });
  });
});
