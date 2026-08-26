import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deleteProjectFile, renameProjectFile } from "./project-file-mutations.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryProject() {
  const projectRoot = await mkdtemp(join(tmpdir(), "codexly-file-mutation-"));
  temporaryDirectories.push(projectRoot);
  return projectRoot;
}

describe("project file mutations", () => {
  it("renames a project file without changing its contents", async () => {
    const projectRoot = await createTemporaryProject();
    await mkdir(join(projectRoot, "src"));
    await writeFile(join(projectRoot, "src", "main.ts"), "export {};\n");

    await expect(renameProjectFile(projectRoot, "src/main.ts", "app.ts")).resolves.toEqual({
      path: "src/app.ts",
    });
    await expect(readFile(join(projectRoot, "src", "app.ts"), "utf8")).resolves.toBe(
      "export {};\n",
    );
    await expect(access(join(projectRoot, "src", "main.ts"))).rejects.toThrow();
  });

  it("recursively deletes a project directory", async () => {
    const projectRoot = await createTemporaryProject();
    await mkdir(join(projectRoot, "generated", "nested"), { recursive: true });
    await writeFile(join(projectRoot, "generated", "nested", "output.txt"), "output\n");

    await expect(deleteProjectFile(projectRoot, "generated")).resolves.toEqual({
      path: "generated",
      status: "deleted",
    });
    await expect(access(join(projectRoot, "generated"))).rejects.toThrow();
  });

  it("rejects root, conflicting, escaping, and symbolic-link targets", async () => {
    const projectRoot = await createTemporaryProject();
    const outsideRoot = await createTemporaryProject();
    await Promise.all([
      writeFile(join(projectRoot, "current.txt"), "current\n"),
      writeFile(join(projectRoot, "existing.txt"), "existing\n"),
      writeFile(join(outsideRoot, "outside.txt"), "outside\n"),
    ]);
    await symlink(join(outsideRoot, "outside.txt"), join(projectRoot, "linked.txt"));

    await expect(renameProjectFile(projectRoot, "current.txt", "existing.txt")).rejects.toThrow(
      "already exists",
    );
    await expect(renameProjectFile(projectRoot, "current.txt", "../outside.txt")).rejects.toThrow();
    await expect(deleteProjectFile(projectRoot, ".")).rejects.toThrow();
    await expect(deleteProjectFile(projectRoot, "../outside.txt")).rejects.toThrow();
    await expect(deleteProjectFile(projectRoot, "linked.txt")).rejects.toThrow("symbolic link");
    await expect(readFile(join(outsideRoot, "outside.txt"), "utf8")).resolves.toBe("outside\n");
  });
});
