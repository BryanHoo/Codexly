import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  it("returns local Skills unchanged and only reveals discovered files", async () => {
    const projectRoot = await temporaryDirectory();
    const skillPath = join(projectRoot, ".agents/skills/review/SKILL.md");
    await mkdir(dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "---\nname: review\ndescription: Review code.\n---\n");
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

    const discovered = await provider.listInstalledSkills();
    await expect(service.listInstalledSkills(false)).resolves.toEqual(discovered);
    expect(provider.listInstalledSkills).toHaveBeenLastCalledWith(projects, false);
    await service.listInstalledSkills(true);
    expect(provider.listInstalledSkills).toHaveBeenLastCalledWith(projects, true);
    await expect(service.openSkillDirectory(skillPath)).resolves.toEqual({ status: "opened" });
    const canonicalSkillPath = await realpath(skillPath);
    expect(open).toHaveBeenCalledWith(dirname(canonicalSkillPath), "finder", canonicalSkillPath);
    await expect(
      service.openSkillDirectory(join(projectRoot, "unknown/SKILL.md")),
    ).rejects.toMatchObject({
      name: "SkillDirectoryError",
    });
  });
});
