import type { AgentProvider, AgentRuntimeProvider, ProjectRepository } from "@code-agent/core";
import type { Project } from "@code-agent/protocol";
import { describe, expect, it, vi } from "vitest";

import { resolveTaskScope } from "./task-scope.js";

describe("resolveTaskScope", () => {
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
      temporaryWorkspace: "/workspace/temporary",
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
