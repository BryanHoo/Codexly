import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSkillMarketService } from "./skill-market-service.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "codexly-skill-service-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("SkillMarketService", () => {
  it("enriches installed Skills and only reveals discovered files", async () => {
    const projectRoot = await temporaryDirectory();
    const skillPath = join(projectRoot, ".agents/skills/review/SKILL.md");
    await mkdir(dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "---\nname: review\ndescription: Review code.\n---\n");
    await mkdir(join(dirname(skillPath), ".clawhub"));
    await writeFile(
      join(dirname(skillPath), ".clawhub/origin.json"),
      JSON.stringify({
        fingerprint: "a".repeat(64),
        installedVersion: "1.0.0",
        ownerHandle: "codex",
        registry: "https://clawhub.ai",
        slug: "review",
        version: 1,
      }),
    );
    const projects = [
      {
        createdAt: "2026-09-04T00:00:00.000Z",
        id: "project-a",
        name: "Project A",
        roots: [{ id: "root-a", path: projectRoot }],
      },
    ];
    const provider = {
      listInstalledSkills: vi.fn(() =>
        Promise.resolve({
          data: [
            {
              description: "Review code.",
              displayName: "Review",
              enabled: true,
              id: "skill-a",
              name: "review",
              path: skillPath,
              projectId: "project-a",
              projectName: "Project A",
              rootPath: projectRoot,
              scope: "repo" as const,
              source: "local" as const,
            },
          ],
          nextCursor: null,
        }),
      ),
      listConfiguredMcpServers: vi.fn(),
      setMcpServerEnabled: vi.fn(),
      setSkillEnabled: vi.fn(),
    };
    const open = vi.fn(() => Promise.resolve());
    const service = createSkillMarketService({
      catalog: {} as never,
      homeDirectory: projectRoot,
      projectOpenService: {
        getCapabilities: vi.fn(() =>
          Promise.resolve({
            apps: [{ id: "finder" as const, kind: "file-manager" as const, name: "Finder" }],
            platform: "darwin" as const,
          }),
        ),
        open,
      },
      projectRepository: {
        list: vi.fn(() => Promise.resolve(projects)),
        read: vi.fn(() => Promise.resolve(projects[0])),
      } as never,
      provider: provider as never,
    });

    await expect(service.listInstalledSkills(false)).resolves.toMatchObject({
      data: [
        {
          marketplace: { installedVersion: "1.0.0", owner: "codex", slug: "review" },
          source: "clawhub",
        },
      ],
    });
    await expect(service.openSkillDirectory(skillPath)).resolves.toEqual({ status: "opened" });
    const canonicalSkillPath = await realpath(skillPath);
    expect(open).toHaveBeenCalledWith(dirname(canonicalSkillPath), "finder", canonicalSkillPath);
    await expect(
      service.openSkillDirectory(join(projectRoot, "unknown/SKILL.md")),
    ).rejects.toMatchObject({
      code: "SKILL_MARKET_FILESYSTEM",
    });
  });

  it("installs a clean project Skill and refreshes Codex discovery", async () => {
    const projectRoot = await temporaryDirectory();
    const projects = [
      {
        createdAt: "2026-09-04T00:00:00.000Z",
        id: "project-a",
        name: "Project A",
        roots: [{ id: "root-a", path: projectRoot }],
      },
    ];
    const listInstalledSkills = vi.fn(() => Promise.resolve({ data: [], nextCursor: null }));
    const catalog = {
      downloadArchive: vi.fn(() =>
        Promise.resolve({
          bytes: zipSync({
            "SKILL.md": strToU8("---\nname: review\ndescription: Review code.\n---\n"),
          }),
          contentHash: null,
          sourcePath: null,
        }),
      ),
      getSkill: vi.fn(() => Promise.resolve({ latestVersion: "1.2.0", scanStatus: "clean" })),
      listSkills: vi.fn(),
    };
    const service = createSkillMarketService({
      catalog: catalog as never,
      homeDirectory: projectRoot,
      projectOpenService: {} as never,
      projectRepository: {
        list: vi.fn(() => Promise.resolve(projects)),
        read: vi.fn(() => Promise.resolve(projects[0])),
      } as never,
      provider: { listInstalledSkills } as never,
    });

    await expect(
      service.installSkill("codex", "review", {
        projectId: "project-a",
        rootPath: projectRoot,
        scope: "project",
      }),
    ).resolves.toMatchObject({ status: "installed", version: "1.2.0" });
    expect(listInstalledSkills).toHaveBeenLastCalledWith(projects, true);
  });
});
