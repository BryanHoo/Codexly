import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ProjectProjectionStore } from "@codexly/core";
import type { Project } from "@codexly/protocol";

import { CodexProtocolMappingError } from "./codex-protocol-mapping.js";
import { CodexProjectRepository } from "./codex-project-repository.js";

function projectRoot(path: string) {
  return { id: createHash("sha256").update(path).digest("hex"), path };
}

const firstProject: Project = {
  createdAt: "2026-08-21T01:00:00.000Z",
  id: "project-1",
  name: "First",
  roots: [projectRoot("/workspace/first")],
};

const secondProject: Project = {
  createdAt: "2026-08-21T02:00:00.000Z",
  id: "project-2",
  name: "Second",
  roots: [projectRoot("/workspace/second")],
};

function primaryRootPath(project: Project): string {
  const root = project.roots[0];
  if (root === undefined) throw new Error("missing primary root");
  return root.path;
}

function nativeProject(project: Project, position: number, roots = project.roots) {
  return {
    createdAt: Date.parse(project.createdAt) / 1_000,
    id: project.id,
    metadata: {},
    name: project.name,
    position,
    roots: roots.map(({ path }) => ({ path })),
    updatedAt: Date.parse(project.createdAt) / 1_000,
  };
}

function createProjection(initial: readonly Project[] = []) {
  let projects = [...initial];
  const projection = {
    completeProjectSourceMigration: vi.fn(() => Promise.resolve()),
    deleteProject: vi.fn((projectId: string) => {
      const previousLength = projects.length;
      projects = projects.filter((project) => project.id !== projectId);
      return Promise.resolve(projects.length !== previousLength);
    }),
    list: vi.fn(() => Promise.resolve(projects)),
    migrateProject: vi.fn((legacyProjectId: string, project: Project) => {
      projects = [...projects.filter((candidate) => candidate.id !== legacyProjectId), project];
      return Promise.resolve(project);
    }),
    read: vi.fn((projectId: string) =>
      Promise.resolve(projects.find((project) => project.id === projectId)),
    ),
    readProjectSourceMigration: vi.fn(() =>
      Promise.resolve({ completed: true, recoverUnassigned: false }),
    ),
    replaceProjects: vi.fn((nextProjects: readonly Project[]) => {
      projects = [...nextProjects];
      return Promise.resolve(projects);
    }),
    setProjectOrder: vi.fn((projectIds: readonly string[]) => {
      projects = projectIds.map((projectId) => {
        const project = projects.find((candidate) => candidate.id === projectId);
        if (project === undefined) throw new Error("missing projected project");
        return project;
      });
      return Promise.resolve(projects);
    }),
    upsertProject: vi.fn((project: Project) => {
      projects = [...projects.filter((candidate) => candidate.id !== project.id), project];
      return Promise.resolve(project);
    }),
  } satisfies ProjectProjectionStore & {
    migrateProject(legacyProjectId: string, project: Project): Promise<Project>;
  };
  return projection;
}

function createRpc(responses: readonly unknown[], events: string[] = []) {
  const queued = [...responses];
  return {
    request: vi.fn((method: string, params?: unknown) => {
      void params;
      events.push(`rpc:${method}`);
      const response = queued.shift();
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    }),
  };
}

function nativeLegacyThread(
  id: string,
  cwd: string,
  historyMode: "legacy" | "paginated" = "paginated",
) {
  return {
    cwd,
    ephemeral: false,
    historyMode,
    id,
    projectId: null,
    source: "vscode",
  };
}

describe("CodexProjectRepository", () => {
  it("preserves every ordered Codex project root in the public projection", async () => {
    const roots = [projectRoot("/workspace/primary"), projectRoot("/workspace/secondary")];
    const aggregate = {
      createdAt: firstProject.createdAt,
      id: "aggregate-project",
      name: "Aggregate",
      roots,
    } as Project;
    const projection = createProjection();
    const rpc = createRpc([{ data: [nativeProject(aggregate, 1, roots)], nextCursor: null }]);

    await expect(new CodexProjectRepository(rpc, projection).synchronize()).resolves.toEqual([
      aggregate,
    ]);
    expect(projection.replaceProjects).toHaveBeenCalledWith([aggregate]);
  });

  it("pages through Codex projects and replaces the local projection in position order", async () => {
    const projection = createProjection();
    const rpc = createRpc([
      { data: [nativeProject(secondProject, 20)], nextCursor: "next" },
      { data: [nativeProject(firstProject, 10)], nextCursor: null },
    ]);
    const repository = new CodexProjectRepository(rpc, projection);

    await expect(repository.synchronize()).resolves.toEqual([firstProject, secondProject]);
    expect(rpc.request).toHaveBeenNthCalledWith(1, "project/list", { limit: 100 });
    expect(rpc.request).toHaveBeenNthCalledWith(2, "project/list", {
      cursor: "next",
      limit: 100,
    });
    expect(projection.replaceProjects).toHaveBeenCalledWith([firstProject, secondProject]);
  });

  it("reads Codex first and updates the local projection", async () => {
    const projection = createProjection([firstProject]);
    const updated = { ...firstProject, name: "Updated" };
    const rpc = createRpc([{ project: nativeProject(updated, 10) }]);
    const repository = new CodexProjectRepository(rpc, projection);

    await expect(repository.read(firstProject.id)).resolves.toEqual(updated);
    expect(rpc.request).toHaveBeenCalledWith("project/read", { projectId: firstProject.id });
    expect(projection.upsertProject).toHaveBeenCalledWith(updated);
  });

  it("imports a legacy local project with its existing Codex threads before projection sync", async () => {
    const legacyProject = { ...firstProject, id: "legacy-local-id" };
    const importedProject = { ...firstProject, id: "codex-project-id" };
    const projection = createProjection([legacyProject]);
    const rpc = createRpc([
      { data: [], nextCursor: null },
      {
        data: [
          nativeLegacyThread("legacy-task-1", primaryRootPath(legacyProject)),
          nativeLegacyThread("legacy-task-2", primaryRootPath(legacyProject), "legacy"),
        ],
        nextCursor: null,
      },
      {
        data: [nativeLegacyThread("archived-task", primaryRootPath(legacyProject), "legacy")],
        nextCursor: null,
      },
      { project: nativeProject(importedProject, 0) },
    ]);
    const repository = new CodexProjectRepository(rpc, projection);

    await repository.migrateLegacyProjects({ recoverUnassigned: false });

    expect(rpc.request).toHaveBeenNthCalledWith(2, "thread/list", {
      archived: false,
      cwd: [primaryRootPath(legacyProject)],
      limit: 100,
      projectId: null,
      sourceKinds: ["vscode"],
    });
    expect(rpc.request).toHaveBeenNthCalledWith(3, "thread/list", {
      archived: true,
      cwd: [primaryRootPath(legacyProject)],
      limit: 100,
      projectId: null,
      sourceKinds: ["vscode"],
    });
    expect(rpc.request).toHaveBeenNthCalledWith(4, "project/import", {
      idempotencyKey: "codexly:legacy-project:legacy-local-id",
      metadata: { codexlyMigration: "legacy-project-v1" },
      name: legacyProject.name,
      roots: [{ path: primaryRootPath(legacyProject) }],
      threads: ["legacy-task-1", "legacy-task-2", "archived-task"],
    });
    expect(projection.migrateProject).toHaveBeenCalledWith(legacyProject.id, importedProject);
  });

  it("prefers the existing Codex id when multiple upstream projects share a root", async () => {
    const competingProject = { ...firstProject, id: "competing-project-id" };
    const projection = createProjection([firstProject]);
    const rpc = createRpc([
      {
        data: [nativeProject(competingProject, 0), nativeProject(firstProject, 1)],
        nextCursor: null,
      },
      {
        data: [nativeLegacyThread("legacy-task", primaryRootPath(firstProject))],
        nextCursor: null,
      },
      { data: [], nextCursor: null },
      { thread: { id: "legacy-task", projectId: firstProject.id } },
    ]);
    const repository = new CodexProjectRepository(rpc, projection);

    await repository.migrateLegacyProjects({ recoverUnassigned: false });

    expect(rpc.request).toHaveBeenNthCalledWith(4, "thread/metadata/update", {
      projectId: firstProject.id,
      threadId: "legacy-task",
    });
    expect(projection.migrateProject).not.toHaveBeenCalled();
  });

  it("recovers projects already erased by version 14 from unassigned Codexly threads", async () => {
    const recoveredProject = {
      ...firstProject,
      id: "recovered-project-id",
      name: "first",
    };
    const projection = createProjection();
    const rpc = createRpc([
      { data: [], nextCursor: null },
      {
        data: [nativeLegacyThread("legacy-task", primaryRootPath(firstProject))],
        nextCursor: null,
      },
      { data: [], nextCursor: null },
      { project: nativeProject(recoveredProject, 0) },
    ]);
    const repository = new CodexProjectRepository(rpc, projection);

    await repository.migrateLegacyProjects({ recoverUnassigned: true });

    expect(rpc.request).toHaveBeenNthCalledWith(2, "thread/list", {
      archived: false,
      limit: 100,
      projectId: null,
      sourceKinds: ["vscode"],
    });
    expect(rpc.request).toHaveBeenNthCalledWith(3, "thread/list", {
      archived: true,
      limit: 100,
      projectId: null,
      sourceKinds: ["vscode"],
    });
    expect(rpc.request).toHaveBeenNthCalledWith(4, "project/import", {
      idempotencyKey:
        "codexly:unassigned-vscode:137219d36395cedc4eacd4d74308c51184e54616b2a5c957a411ce5aa43c9e30",
      metadata: { codexlyMigration: "unassigned-vscode-v2" },
      name: "first",
      roots: [{ path: primaryRootPath(firstProject) }],
      threads: ["legacy-task"],
    });
  });

  it("reattaches legacy threads when the erased project was already re-added to Codex", async () => {
    const readdedProject = { ...firstProject, id: "readded-project-id" };
    const projection = createProjection();
    const rpc = createRpc([
      { data: [nativeProject(readdedProject, 0)], nextCursor: null },
      {
        data: [nativeLegacyThread("legacy-task", primaryRootPath(readdedProject))],
        nextCursor: null,
      },
      { data: [], nextCursor: null },
      { thread: { id: "legacy-task", projectId: readdedProject.id } },
    ]);
    const repository = new CodexProjectRepository(rpc, projection);

    await repository.migrateLegacyProjects({ recoverUnassigned: true });

    expect(rpc.request).toHaveBeenNthCalledWith(4, "thread/metadata/update", {
      projectId: readdedProject.id,
      threadId: "legacy-task",
    });
    expect(rpc.request).not.toHaveBeenCalledWith("project/import", expect.anything());
  });

  it("writes Codex before projecting create, update, and delete", async () => {
    const events: string[] = [];
    const projection = createProjection();
    projection.upsertProject.mockImplementation((project) => {
      events.push(`projection:upsert:${project.id}`);
      return Promise.resolve(project);
    });
    projection.deleteProject.mockImplementation((projectId) => {
      events.push(`projection:delete:${projectId}`);
      return Promise.resolve(true);
    });
    const renamed = { ...firstProject, name: "Renamed" };
    const rpc = createRpc(
      [{ project: nativeProject(firstProject, 10) }, { project: nativeProject(renamed, 10) }, {}],
      events,
    );
    const repository = new CodexProjectRepository(rpc, projection);

    await repository.register({
      idempotencyKey: "request-1",
      name: firstProject.name,
      roots: [{ path: primaryRootPath(firstProject) }, { path: "/workspace/secondary" }],
    });
    await repository.rename(firstProject.id, renamed.name);
    await repository.remove(firstProject.id);

    expect(events).toEqual([
      "rpc:project/create",
      "projection:upsert:project-1",
      "rpc:project/update",
      "projection:upsert:project-1",
      "rpc:project/delete",
      "projection:delete:project-1",
    ]);
    expect(rpc.request).toHaveBeenNthCalledWith(1, "project/create", {
      idempotencyKey: "request-1",
      metadata: {},
      name: firstProject.name,
      roots: [{ path: primaryRootPath(firstProject) }, { path: "/workspace/secondary" }],
    });
  });

  it("moves projects through Codex and only then stores the requested order", async () => {
    const projection = createProjection([firstProject, secondProject]);
    const rpc = createRpc([{}, {}]);
    const repository = new CodexProjectRepository(rpc, projection);

    await expect(repository.reorder([secondProject.id, firstProject.id])).resolves.toEqual([
      secondProject,
      firstProject,
    ]);
    expect(rpc.request).toHaveBeenNthCalledWith(1, "project/move", {
      beforeProjectId: null,
      projectId: firstProject.id,
    });
    expect(rpc.request).toHaveBeenNthCalledWith(2, "project/move", {
      beforeProjectId: firstProject.id,
      projectId: secondProject.id,
    });
    expect(projection.setProjectOrder).toHaveBeenCalledWith([secondProject.id, firstProject.id]);
  });

  it("reconciles the projection after a partially failed reorder", async () => {
    const projection = createProjection([firstProject, secondProject]);
    const rpc = createRpc([
      {},
      new Error("move failed"),
      {
        data: [nativeProject(firstProject, 10), nativeProject(secondProject, 20)],
        nextCursor: null,
      },
    ]);
    const repository = new CodexProjectRepository(rpc, projection);

    await expect(repository.reorder([secondProject.id, firstProject.id])).rejects.toThrow(
      "move failed",
    );
    expect(projection.setProjectOrder).not.toHaveBeenCalled();
    expect(projection.replaceProjects).toHaveBeenCalledWith([firstProject, secondProject]);
  });

  it("rejects malformed roots and repeated project cursors", async () => {
    const missingRoot = new CodexProjectRepository(
      createRpc([{ data: [nativeProject(firstProject, 1, [])], nextCursor: null }]),
      createProjection(),
    );
    const repeatedCursor = new CodexProjectRepository(
      createRpc([
        { data: [], nextCursor: "same" },
        { data: [], nextCursor: "same" },
      ]),
      createProjection(),
    );

    await expect(missingRoot.synchronize()).rejects.toThrow(CodexProtocolMappingError);
    await expect(repeatedCursor.synchronize()).rejects.toThrow(/repeated cursor/u);
  });
});
