import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

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
  it
    .runIf(process.platform === "win32")
    .each([
      "renamed.",
      "renamed ",
      "CON",
      "nul.txt",
      "COM1.log",
      "LPT9",
      "COM¹.txt",
      "LPT²",
      "file:stream",
      'file"name',
      "file?name",
      "file|name",
      "file<name",
      "file>name",
      "file*name",
      "file\u0001name",
    ])("rejects Windows filename aliases and invalid names: %j", async (name) => {
    const projectRoot = await createTemporaryProject();
    await writeFile(join(projectRoot, "current.txt"), "preserved\n");
    await expect(renameProjectFile(projectRoot, "current.txt", name)).rejects.toThrow(
      "Project file name is invalid",
    );
    await expect(readFile(join(projectRoot, "current.txt"), "utf8")).resolves.toBe("preserved\n");
  });

  it.runIf(process.platform === "win32" && parse(process.cwd()).root !== parse(tmpdir()).root)(
    "rejects mutations through a junction pointing to another Windows drive",
    async () => {
      const projectRoot = await mkdtemp(join(process.cwd(), "codexly-cross-drive-"));
      temporaryDirectories.push(projectRoot);
      const outsideRoot = await createTemporaryProject();
      await writeFile(join(outsideRoot, "outside.txt"), "preserved\n");
      await symlink(outsideRoot, join(projectRoot, "linked"), "junction");

      await expect(
        renameProjectFile(projectRoot, "linked/outside.txt", "renamed.txt"),
      ).rejects.toThrow("outside the project root");
      await expect(deleteProjectFile(projectRoot, "linked/outside.txt")).rejects.toThrow(
        "outside the project root",
      );
      await expect(readFile(join(outsideRoot, "outside.txt"), "utf8")).resolves.toBe("preserved\n");
    },
  );

  it("renames and deletes Unicode files in directories containing spaces", async () => {
    const projectRoot = await createTemporaryProject();
    await mkdir(join(projectRoot, "中文 目录"));
    await writeFile(join(projectRoot, "中文 目录", "原文件.txt"), "第一行\r\n第二行\r\n");
    await expect(
      renameProjectFile(projectRoot, "中文 目录/原文件.txt", "新文件 & 数据.txt"),
    ).resolves.toEqual({
      path: "中文 目录/新文件 & 数据.txt",
    });
    await expect(
      readFile(join(projectRoot, "中文 目录", "新文件 & 数据.txt"), "utf8"),
    ).resolves.toBe("第一行\r\n第二行\r\n");
    await deleteProjectFile(projectRoot, "中文 目录/新文件 & 数据.txt");
    await expect(access(join(projectRoot, "中文 目录", "新文件 & 数据.txt"))).rejects.toThrow();
  });

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
    await symlink(outsideRoot, join(projectRoot, "linked"), "junction");

    await expect(renameProjectFile(projectRoot, "current.txt", "existing.txt")).rejects.toThrow(
      "already exists",
    );
    await expect(renameProjectFile(projectRoot, "current.txt", "../outside.txt")).rejects.toThrow();
    await expect(deleteProjectFile(projectRoot, ".")).rejects.toThrow();
    await expect(deleteProjectFile(projectRoot, "../outside.txt")).rejects.toThrow();
    await expect(deleteProjectFile(projectRoot, "linked")).rejects.toThrow("symbolic link");
    await expect(deleteProjectFile(projectRoot, "linked/outside.txt")).rejects.toThrow(
      "outside the project root",
    );
    await expect(readFile(join(outsideRoot, "outside.txt"), "utf8")).resolves.toBe("outside\n");
  });
});
