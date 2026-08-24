import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  repositories,
  createProject,
  createWorkspace,
  openRepository,
} from "./sqlite-state-repository.test-support.js";

describe("SQLite project state", () => {
  it("persists complete project ordering and appends newly registered projects", async () => {
    const root = await createWorkspace();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    const thirdRoot = join(root, "third");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot), mkdir(thirdRoot)]);
    const repository = await openRepository(root);
    const first = createProject("codex-first", "First", firstRoot);
    const second = createProject("codex-second", "Second", secondRoot);
    await repository.upsertProject(first);
    await repository.upsertProject(second);

    await expect(repository.setProjectOrder([second.id, first.id])).resolves.toEqual([
      second,
      first,
    ]);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = await openRepository(root);
    const third = createProject("codex-third", "Third", thirdRoot);
    await reopened.upsertProject(third);
    await expect(reopened.list()).resolves.toEqual([second, first, third]);
  });

  it("rejects incomplete or duplicated project ordering without partial writes", async () => {
    const root = await createWorkspace();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const repository = await openRepository(root);
    const first = createProject("codex-first", "First", firstRoot);
    const second = createProject("codex-second", "Second", secondRoot);
    await repository.upsertProject(first);
    await repository.upsertProject(second);

    await expect(repository.setProjectOrder([second.id])).rejects.toThrow(
      /every project exactly once/u,
    );
    await expect(repository.setProjectOrder([first.id, first.id])).rejects.toThrow(
      /every project exactly once/u,
    );
    await expect(repository.list()).resolves.toEqual([first, second]);
  });

  it("updates and removes only the local Codex project projection", async () => {
    const root = await createWorkspace();
    const projectRoot = join(root, "workspace");
    await mkdir(projectRoot);
    const repository = await openRepository(root);
    const project = createProject("codex-workspace", "Workspace", projectRoot);
    await repository.upsertProject(project);
    await repository.writeProjectDefaults(project.id, {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      fastMode: false,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });

    const renamed = await repository.upsertProject({ ...project, name: "工作区别名" });

    expect(renamed).toEqual({ ...project, name: "工作区别名" });
    expect(renamed.roots).toEqual(project.roots);
    await expect(repository.deleteProject("missing")).resolves.toBe(false);
    await expect(repository.deleteProject(project.id)).resolves.toBe(true);
    await expect(repository.read(project.id)).resolves.toBeUndefined();
    await expect(repository.readProjectDefaults(project.id)).resolves.toBeUndefined();
    await expect(stat(projectRoot)).resolves.toMatchObject({});

    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);
    const reopened = await openRepository(root);
    await expect(reopened.list()).resolves.toEqual([]);
    await expect(stat(projectRoot)).resolves.toMatchObject({});
  });
});
