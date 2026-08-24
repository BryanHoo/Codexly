import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { filterProjectFileSearchMatches } from "./project-file-search.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("filterProjectFileSearchMatches", () => {
  it("keeps only bounded regular files inside the project tree", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "code-agent-native-search-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "code-agent-native-search-outside-"));
    temporaryDirectories.push(projectRoot, outsideRoot);
    await Promise.all([
      mkdir(join(projectRoot, "dist")),
      mkdir(join(projectRoot, "src")),
      writeFile(join(outsideRoot, "secret.ts"), "secret\n"),
    ]);
    await Promise.all([
      writeFile(join(projectRoot, "dist", "generated.ts"), "generated\n"),
      writeFile(join(projectRoot, "src", "agent.ts"), "export {};\n"),
      symlink(join(outsideRoot, "secret.ts"), join(projectRoot, "src", "linked.ts")),
    ]);

    await expect(
      filterProjectFileSearchMatches(projectRoot, {
        data: [
          { name: "agent.ts", path: "src/agent.ts", rootPath: projectRoot },
          { name: "generated.ts", path: "dist/generated.ts", rootPath: projectRoot },
          { name: "linked.ts", path: "src/linked.ts", rootPath: projectRoot },
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
