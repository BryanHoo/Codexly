import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_SOURCE_FILE_PREVIEW_BYTES,
  MAX_SOURCE_FILE_PREVIEW_LINES,
  readProjectSourceFile,
} from "./project-source-file.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryProject() {
  const projectRoot = await mkdtemp(join(tmpdir(), "code-agent-source-"));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, "docs"));
  return projectRoot;
}

describe("readProjectSourceFile", () => {
  it("reads text files under the project root using a relative response path", async () => {
    const projectRoot = await createTemporaryProject();
    const sourcePath = join(projectRoot, "docs", "architecture-design.md");
    await writeFile(sourcePath, "# Architecture\n\nDetails\n");

    await expect(
      readProjectSourceFile(projectRoot, "docs/architecture-design.md"),
    ).resolves.toEqual({
      content: "# Architecture\n\nDetails\n",
      nextCursor: null,
      path: "docs/architecture-design.md",
    });
  });

  it("reads text files from an absolute path outside the project root", async () => {
    const projectRoot = await createTemporaryProject();
    const outsideRoot = await mkdtemp(join(tmpdir(), "code-agent-source-outside-"));
    temporaryDirectories.push(outsideRoot);
    const sourcePath = join(outsideRoot, "report.md");
    await writeFile(sourcePath, "# Report\n\nDetails\n");
    const resolvedSourcePath = await realpath(sourcePath);

    await expect(readProjectSourceFile(projectRoot, sourcePath)).resolves.toEqual({
      content: "# Report\n\nDetails\n",
      nextCursor: null,
      path: resolvedSourcePath,
    });
  });

  it("paginates large UTF-8 files without losing or duplicating content", async () => {
    const projectRoot = await createTemporaryProject();
    const sourcePath = join(projectRoot, "docs", "large.md");
    const source = `${"认证边界".repeat(96)}\n`.repeat(MAX_SOURCE_FILE_PREVIEW_LINES + 500);
    await writeFile(sourcePath, source);

    const chunks: string[] = [];
    let cursor: number | undefined;
    for (;;) {
      const page = await readProjectSourceFile(projectRoot, sourcePath, cursor);
      chunks.push(page.content);
      expect(Buffer.byteLength(page.content, "utf8")).toBeLessThanOrEqual(
        MAX_SOURCE_FILE_PREVIEW_BYTES,
      );
      if (page.nextCursor === null) {
        break;
      }
      expect(page.nextCursor).toBeGreaterThan(cursor ?? 0);
      cursor = page.nextCursor;
    }

    expect(chunks.join("")).toBe(source);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("uses the line limit as a lossless page boundary", async () => {
    const projectRoot = await createTemporaryProject();
    const sourcePath = join(projectRoot, "docs", "many-lines.md");
    const source = "line\n".repeat(MAX_SOURCE_FILE_PREVIEW_LINES + 100);
    await writeFile(sourcePath, source);

    const firstPage = await readProjectSourceFile(projectRoot, sourcePath);
    expect(firstPage.content).toBe("line\n".repeat(MAX_SOURCE_FILE_PREVIEW_LINES));
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await readProjectSourceFile(
      projectRoot,
      sourcePath,
      firstPage.nextCursor ?? undefined,
    );
    expect(firstPage.content + secondPage.content).toBe(source);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("rejects cursors beyond the file boundary", async () => {
    const projectRoot = await createTemporaryProject();
    const sourcePath = join(projectRoot, "docs", "short.md");
    await writeFile(sourcePath, "short");

    await expect(readProjectSourceFile(projectRoot, sourcePath, 6)).rejects.toThrow(
      "Source cursor is outside the file",
    );
  });

  it("rejects project-relative symbolic links outside the project root", async () => {
    const projectRoot = await createTemporaryProject();
    const outsidePath = join(tmpdir(), `outside-${String(Date.now())}.md`);
    temporaryDirectories.push(outsidePath);
    await writeFile(outsidePath, "secret");
    const linkedPath = join(projectRoot, "docs", "outside.md");
    await symlink(outsidePath, linkedPath);

    await expect(readProjectSourceFile(projectRoot, "docs/outside.md")).rejects.toThrow(
      "outside the project root",
    );
  });
});
