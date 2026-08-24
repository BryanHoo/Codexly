import { describe, expect, it, vi } from "vitest";

import type { ProjectRepository } from "@codexly/core";
import type { Project } from "@codexly/protocol";

import { resolveProjectRoot, resolveProjectRootEntry } from "./project-root-scope.js";

const project: Project = {
  createdAt: "2026-08-22T00:00:00.000Z",
  id: "aggregate",
  name: "Aggregate",
  roots: [
    { id: "root-primary", path: "/workspace/primary" },
    { id: "root-secondary", path: "/workspace/secondary" },
  ],
};

function createRepository(value: Project | undefined): ProjectRepository {
  return {
    list: vi.fn(() => Promise.resolve(value === undefined ? [] : [value])),
    read: vi.fn(() => Promise.resolve(value)),
    register: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    reorder: vi.fn(),
  };
}

describe("resolveProjectRoot", () => {
  it("resolves a selected member and defaults internal callers to the primary root", async () => {
    const repository = createRepository(project);

    await expect(resolveProjectRoot(repository, project.id, "/workspace/secondary")).resolves.toBe(
      "/workspace/secondary",
    );
    await expect(resolveProjectRoot(repository, project.id)).resolves.toBe("/workspace/primary");
    await expect(
      resolveProjectRootEntry(repository, project.id, "/workspace/secondary"),
    ).resolves.toEqual(project.roots[1]);
  });

  it("rejects unknown projects and roots without probing the filesystem", async () => {
    await expect(resolveProjectRoot(createRepository(undefined), project.id)).rejects.toMatchObject(
      {
        code: "PROJECT_NOT_FOUND",
      },
    );
    await expect(
      resolveProjectRoot(createRepository(project), project.id, "/workspace/outside"),
    ).rejects.toHaveProperty("code", "PROJECT_ROOT_INVALID");
  });
});
