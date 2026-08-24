import { describe, expect, it } from "vitest";

import { CodexProtocolMappingError } from "./codex-protocol-mapping.js";
import { RuntimeOwnerRegistry } from "./runtime-owner-registry.js";

const project = {
  createdAt: "2026-08-02T00:00:00.000Z",
  id: "project-1",
  kind: "project" as const,
  name: "Project",
  rootPath: "/workspace/project",
  runtimeWorkspaceRoots: ["/workspace/project"],
};

describe("RuntimeOwnerRegistry", () => {
  it("keeps provisional reads separate from confirmed ownership", () => {
    const registry = new RuntimeOwnerRegistry();

    expect(registry.beginTaskRead(project, "task-1")).toBe(true);
    expect(registry.isTaskOwner(project, "task-1")).toBe(false);

    registry.claimTask(project, "task-1");
    expect(registry.isTaskOwner(project, "task-1")).toBe(true);
    expect(registry.projectIdForTask("task-1")).toBe("project-1");
  });

  it("rejects another project and only releases matching ownership", () => {
    const registry = new RuntimeOwnerRegistry();
    registry.claimTask(project, "task-1");
    const otherProject = { ...project, id: "project-2", rootPath: "/workspace/other" };

    expect(() => {
      registry.claimTask(otherProject, "task-1");
    }).toThrow(CodexProtocolMappingError);
    registry.releaseTask(otherProject, "task-1");
    expect(registry.isTaskOwner(project, "task-1")).toBe(true);
    registry.releaseTask(project, "task-1");
    expect(registry.projectIdForTask("task-1")).toBeUndefined();
  });
});
