import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { filterProjectFileSearchMatches } from "./project-file-search.js";
import { LocalFileSearchService } from "./local-file-search.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("filterProjectFileSearchMatches", () => {
  it("searches files without an agent runtime and excludes links and generated directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "codexly-local-search-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "src", "agent.ts"), "");
    await writeFile(join(root, "node_modules", "agent.ts"), "");
    await writeFile(join(root, ".gitignore"), "ignored-agent.ts\n");
    await writeFile(join(root, "ignored-agent.ts"), "");
    await symlink(join(root, "src", "agent.ts"), join(root, "agent-link.ts"));
    const service = new LocalFileSearchService();
    const input = { projectId: "project", sessionId: "search", roots: [root], query: "agent" };
    expect(await service.search(input)).toEqual({
      data: [{ name: "agent.ts", path: "src/agent.ts", rootPath: root }],
    });
    const controller = new AbortController();
    controller.abort();
    await expect(service.search({ ...input, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
  it("keeps only bounded regular files inside the project tree", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "codexly-native-search-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "codexly-native-search-outside-"));
    temporaryDirectories.push(projectRoot, outsideRoot);
    await Promise.all([
      mkdir(join(projectRoot, "dist")),
      mkdir(join(projectRoot, "src")),
      writeFile(join(outsideRoot, "secret.ts"), "secret\n"),
    ]);
    await Promise.all([
      writeFile(join(projectRoot, "dist", "generated.ts"), "generated\n"),
      writeFile(join(projectRoot, "src", "agent.ts"), "export {};\n"),
      symlink(outsideRoot, join(projectRoot, "src", "linked"), "junction"),
    ]);

    await expect(
      filterProjectFileSearchMatches(projectRoot, {
        data: [
          { name: "agent.ts", path: "src/agent.ts", rootPath: projectRoot },
          { name: "generated.ts", path: "dist/generated.ts", rootPath: projectRoot },
          { name: "secret.ts", path: "src/linked/secret.ts", rootPath: projectRoot },
          { name: "missing.ts", path: "src/missing.ts", rootPath: projectRoot },
          { name: "outside.ts", path: "../outside.ts", rootPath: projectRoot },
          { name: "wrong.ts", path: "src/agent.ts", rootPath: outsideRoot },
        ],
      }),
    ).resolves.toEqual({
      data: [{ name: "agent.ts", path: "src/agent.ts", rootPath: projectRoot }],
    });
  });
});
