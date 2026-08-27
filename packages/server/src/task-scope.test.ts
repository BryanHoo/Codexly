import type { AgentProvider, AgentRuntimeProvider, ProjectRepository } from "@codexly/core";
import type { Project } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import { resolveTaskScope } from "./task-scope.js";

describe("resolveTaskScope", () => {
  it("resolves standalone tasks without a synthetic workspace", async () => {
    const temporaryProvider = {} as AgentProvider;
    const forTemporary = vi.fn(() => temporaryProvider);
    const runtimeProvider = {
      forTemporary,
    } as unknown as AgentRuntimeProvider;

    const result = await resolveTaskScope("temporary", {
      projectRepository: {} as ProjectRepository,
      provider: runtimeProvider,
      standaloneCwd: "/runtime/cwd",
    });

    expect(forTemporary).toHaveBeenCalledWith("/runtime/cwd");
    expect(result?.scope.rootPath).toBe("/runtime/cwd");
  });

  it("preserves every project root in the runtime task scope", async () => {
    const project = {
      createdAt: "2026-08-22T00:00:00.000Z",
      id: "aggregate-project",
      name: "Aggregate Project",
      roots: [
        { id: "root-primary", path: "/workspace/primary" },
        { id: "root-secondary", path: "/workspace/secondary" },
      ],
    } satisfies Project;
    const projectProvider = {} as AgentProvider;
    const runtimeProvider = {
      forProject: vi.fn(() => projectProvider),
    } as unknown as AgentRuntimeProvider;
    const projectRepository = {
      read: vi.fn(() => Promise.resolve(project)),
    } as unknown as ProjectRepository;

    const result = await resolveTaskScope(project.id, {
      projectRepository,
      provider: runtimeProvider,
      standaloneCwd: "/runtime/cwd",
    });

    expect(result).toEqual({
      provider: projectProvider,
      scope: {
        id: project.id,
        kind: "project",
        rootPath: "/workspace/primary",
        runtimeWorkspaceRoots: ["/workspace/primary", "/workspace/secondary"],
      },
    });
  });
});
