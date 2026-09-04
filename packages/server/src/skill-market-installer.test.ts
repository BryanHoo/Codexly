import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import { installClawhubArchive, skillContentHash } from "./skill-market-installer.js";
import type { SkillMarketError } from "./skill-market-error.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(name: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `codexly-${name}-`));
  temporaryDirectories.push(path);
  return path;
}

function archive(entries: Readonly<Record<string, string>>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(entries).map(([path, value]) => [path, strToU8(value)])),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("installClawhubArchive", () => {
  it("extracts a wrapped portable skill and records its verified origin", async () => {
    const skillsRoot = await temporaryDirectory("skill-install");
    const result = await installClawhubArchive(
      {
        bytes: archive({
          "package/SKILL.md": "---\nname: review\ndescription: Review code.\n---\n# Review\n",
        }),
        contentHash: null,
        sourcePath: null,
      },
      skillsRoot,
      "codex",
      "review",
      "1.0.0",
    );

    expect(result).toEqual({
      path: join(skillsRoot, "review"),
      status: "installed",
      version: "1.0.0",
    });
    await expect(readFile(join(skillsRoot, "review/SKILL.md"), "utf8")).resolves.toContain(
      "name: review",
    );
    await expect(
      readFile(join(skillsRoot, "review/.clawhub/origin.json"), "utf8"),
    ).resolves.toContain('"installedVersion": "1.0.0"');
  });

  it("extracts only the verified GitHub source path", async () => {
    const skillsRoot = await temporaryDirectory("skill-source-path");
    await installClawhubArchive(
      {
        bytes: archive({
          "repo-main/README.md": "unrelated",
          "repo-main/skills/review/SKILL.md": "---\nname: review\ndescription: Review code.\n---\n",
        }),
        contentHash: null,
        sourcePath: "skills/review",
      },
      skillsRoot,
      "codex",
      "review",
      "1.0.0",
    );

    await expect(readFile(join(skillsRoot, "review/SKILL.md"), "utf8")).resolves.toContain(
      "name: review",
    );
    await expect(readFile(join(skillsRoot, "review/README.md"), "utf8")).rejects.toThrow();
  });

  it("rejects traversal archives and locally modified updates", async () => {
    const skillsRoot = await temporaryDirectory("skill-conflict");
    const portable = archive({
      "SKILL.md": "---\nname: review\ndescription: Review code.\n---\n",
    });
    await expect(
      installClawhubArchive(
        { bytes: archive({ "../escape": "bad" }), contentHash: null, sourcePath: null },
        skillsRoot,
        "codex",
        "review",
        "1.0.0",
      ),
    ).rejects.toMatchObject({ code: "SKILL_MARKET_INVALID_ARCHIVE" });

    await installClawhubArchive(
      { bytes: portable, contentHash: null, sourcePath: null },
      skillsRoot,
      "codex",
      "review",
      "1.0.0",
    );
    await writeFile(join(skillsRoot, "review/SKILL.md"), "local changes");
    await expect(
      installClawhubArchive(
        { bytes: portable, contentHash: null, sourcePath: null },
        skillsRoot,
        "codex",
        "review",
        "1.1.0",
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SkillMarketError>>({
        code: "SKILL_MARKET_CONFLICT",
      }),
    );
  });

  it("hashes files in stable relative-path order and ignores origin metadata", async () => {
    const skillRoot = await temporaryDirectory("skill-hash");
    await mkdir(join(skillRoot, ".clawhub"));
    await writeFile(join(skillRoot, "SKILL.md"), "hello\n");
    await writeFile(join(skillRoot, ".clawhub/origin.json"), "ignored");

    await expect(skillContentHash(skillRoot)).resolves.toBe(
      "4bbbfbca2790e2b4a1e64203fe3bc62399a797bcd8944527f19fe542c6a2e39c",
    );
  });
});
