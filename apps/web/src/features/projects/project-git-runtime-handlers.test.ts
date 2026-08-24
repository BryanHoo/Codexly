import { describe, expect, it, vi } from "vitest";

import { createProjectGitRuntimeHandlers } from "./project-git-runtime-handlers.js";

const project = {
  id: "project-1",
  roots: [
    { id: "root-primary", path: "/workspace/primary" },
    { id: "root-secondary", path: "/workspace/secondary" },
  ],
} as const;

describe("createProjectGitRuntimeHandlers", () => {
  it("routes activity and metadata changes only to the current Project root", () => {
    const handleActivity = vi.fn();
    const handleGitMetadataChanged = vi.fn();
    let selectedRootIds: ReadonlyMap<string, string> = new Map([["project-1", "root-secondary"]]);
    const handlers = createProjectGitRuntimeHandlers({
      coordinator: { handleActivity, handleGitMetadataChanged },
      getProject: (projectId) => (projectId === project.id ? project : undefined),
      getSelectedRootIds: () => selectedRootIds,
    });

    handlers.onProjectGitActivity("temporary", "task-1", "turn_started");
    handlers.onProjectGitActivity("project-1", "task-1", "turn_started");
    handlers.onProjectGitMetadataChanged("project-1", "/workspace/primary");
    handlers.onProjectGitMetadataChanged("project-1", "/workspace/secondary");

    expect(handleActivity).toHaveBeenCalledOnce();
    expect(handleActivity).toHaveBeenCalledWith(
      "project-1",
      "/workspace/secondary",
      "task-1",
      "turn_started",
    );
    expect(handleGitMetadataChanged).toHaveBeenCalledOnce();
    expect(handleGitMetadataChanged).toHaveBeenCalledWith("project-1", "/workspace/secondary");

    selectedRootIds = new Map([["project-1", "root-primary"]]);
    handlers.onProjectGitMetadataChanged("project-1", "/workspace/primary");
    expect(handleGitMetadataChanged).toHaveBeenCalledTimes(2);
  });
});
