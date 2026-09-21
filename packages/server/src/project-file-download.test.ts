import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readProjectFileDownload } from "./project-file-download.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("readProjectFileDownload", () => {
  it("streams generated files without restricting them to the project root", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "codexly-file-download-"));
    temporaryDirectories.push(sandbox);
    const projectRoot = join(sandbox, "project");
    const outsideRoot = join(sandbox, "outside");
    await Promise.all([mkdir(projectRoot), mkdir(outsideRoot)]);
    await Promise.all([
      writeFile(join(projectRoot, "report.txt"), "project report"),
      writeFile(join(outsideRoot, "secret.txt"), "secret"),
    ]);
    await symlink(outsideRoot, join(projectRoot, "linked-outside"), "dir");

    for (const requestedPath of [
      "report.txt",
      "../outside/secret.txt",
      join(outsideRoot, "secret.txt"),
      "linked-outside/secret.txt",
    ]) {
      const download = await readProjectFileDownload(projectRoot, requestedPath);
      download.content.setEncoding("utf8");
      const chunks: string[] = [];
      for await (const chunk of download.content) {
        chunks.push(String(chunk));
      }

      expect(download.name).toBe(requestedPath === "report.txt" ? "report.txt" : "secret.txt");
      expect(chunks.join("")).toBe(requestedPath === "report.txt" ? "project report" : "secret");
    }
  });
});
