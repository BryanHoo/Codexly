import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { AgentQueueRecord } from "@codexly/core";
import { SQLITE_MIGRATIONS } from "./sqlite-state-migrations.js";
import {
  repositories,
  createProject,
  createWorkspace,
  openRepository,
} from "./sqlite-state-repository.test-support.js";

describe("SQLite state migrations", () => {
  it("runs strict migrations and configures the required pragmas", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);

    await expect(repository.diagnose()).resolves.toEqual({
      busyTimeout: 5_000,
      foreignKeys: true,
      integrityCheck: "ok",
      journalMode: "wal",
      migrationVersion: 23,
      synchronous: "normal",
      writable: true,
    });
  });

  it("rolls back a failed migration without recording its version", async () => {
    const root = await createWorkspace();
    const migrations = [
      {
        name: "create_probe",
        sql: "CREATE TABLE migration_probe (id INTEGER PRIMARY KEY) STRICT;",
        version: 1,
      },
      {
        name: "fail_probe",
        sql: "CREATE TABLE broken_probe (id INTEGER PRIMARY KEY) STRICT; INVALID SQL;",
        version: 2,
      },
    ] as const;

    await expect(openRepository(root, { migrations })).rejects.toThrow(/migration|syntax/u);
    const reopened = await openRepository(root, { migrations: migrations.slice(0, 1) });

    await expect(reopened.diagnose()).resolves.toMatchObject({ migrationVersion: 1 });
  });

  it("persists temporary task settings without creating a Project", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    await repository.writeTaskSettings("temporary", "task-1", {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      sandboxMode: "workspace-write",
    });

    await expect(repository.read("temporary")).resolves.toBeUndefined();
    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.readTaskSettings("temporary", "task-1")).resolves.toMatchObject({
      model: "gpt-5.6-terra",
      sandboxMode: "workspace-write",
    });
  });

  it("persists queue order, editing state, and draft text across repository restarts", async () => {
    const root = await createWorkspace();
    const projectRoot = join(root, "workspace");
    await mkdir(projectRoot);
    const repository = await openRepository(root);
    await repository.upsertProject(createProject("codexly", "Codexly", projectRoot));
    const createRecord = (id: string, text: string, status: AgentQueueRecord["status"]) =>
      ({
        clientUserMessageId: `client-${id}`,
        id,
        input: { attachments: [], skills: [], text, type: "prompt" },
        projectId: "codexly",
        status,
        taskId: "task-1",
      }) satisfies AgentQueueRecord;
    await repository.addQueue(createRecord("queue-1", "编辑草稿", "editing"));
    await repository.addQueue(createRecord("queue-2", "后续内容", "queued"));
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = await openRepository(root);

    await expect(reopened.listQueue("codexly", "task-1")).resolves.toEqual([
      createRecord("queue-1", "编辑草稿", "editing"),
      createRecord("queue-2", "后续内容", "queued"),
    ]);
  });

  it("removes the legacy temporary Project without losing its task settings", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const version16 = await openRepository(root, {
      migrations: SQLITE_MIGRATIONS.filter((migration) => migration.version <= 16),
    });
    await version16.close();
    repositories.splice(repositories.indexOf(version16), 1);

    const database = new Database(databasePath);
    database
      .prepare(
        `INSERT INTO projects (id, name, root_path, created_at, sort_order, kind)
         VALUES ('temporary', 'Temporary', '/workspace/temporary', ?, 0, 'temporary')`,
      )
      .run("2026-08-21T00:00:00.000Z");
    database
      .prepare(
        `INSERT INTO task_settings
           (project_id, task_id, approval_policy, approvals_reviewer, model,
            reasoning_effort, sandbox_mode, updated_at)
         VALUES ('temporary', 'task-1', 'never', 'user', 'gpt-5.6-sol',
                 'high', 'read-only', ?)`,
      )
      .run("2026-08-21T00:00:00.000Z");
    database.close();

    const upgraded = await openRepository(root);
    await expect(upgraded.read("temporary")).resolves.toBeUndefined();
    await expect(upgraded.readTaskSettings("temporary", "task-1")).resolves.toMatchObject({
      approvalPolicy: "never",
      model: "gpt-5.6-sol",
      sandboxMode: "read-only",
    });
  });

  it("atomically projects Codex projects by id while allowing a shared root path", async () => {
    const root = await createWorkspace();
    const sharedRoot = join(root, "shared-workspace");
    const otherRoot = join(root, "other-workspace");
    await Promise.all([mkdir(sharedRoot), mkdir(otherRoot)]);
    const repository = await openRepository(root);
    const first = {
      createdAt: "2026-08-21T01:00:00.000Z",
      id: "codex-project-1",
      name: "First",
      roots: [
        { id: "first-shared-root", path: sharedRoot },
        { id: "first-other-root", path: otherRoot },
      ],
    };
    const second = {
      createdAt: "2026-08-21T02:00:00.000Z",
      id: "codex-project-2",
      name: "Second",
      roots: [{ id: "second-shared-root", path: sharedRoot }],
    };

    await expect(repository.replaceProjects([first, second])).resolves.toEqual([first, second]);
    await repository.writeProjectDefaults(first.id, {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      fastMode: false,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });

    const updatedFirst = {
      ...first,
      name: "Updated First",
      roots: [
        { id: "first-other-root", path: otherRoot },
        { id: "first-shared-root", path: sharedRoot },
      ],
    };
    await expect(repository.replaceProjects([second, updatedFirst])).resolves.toEqual([
      second,
      updatedFirst,
    ]);
    await expect(repository.readProjectDefaults(first.id)).resolves.toMatchObject({
      model: "gpt-5.6-sol",
    });
  });

  it("applies incremental Codex project projection mutations", async () => {
    const root = await createWorkspace();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const repository = await openRepository(root);
    const first = {
      createdAt: "2026-08-21T01:00:00.000Z",
      id: "codex-project-1",
      name: "First",
      roots: [
        { id: "first-primary-root", path: firstRoot },
        { id: "first-secondary-root", path: secondRoot },
      ],
    };
    const second = {
      createdAt: "2026-08-21T02:00:00.000Z",
      id: "codex-project-2",
      name: "Second",
      roots: [{ id: "second-primary-root", path: secondRoot }],
    };

    await repository.upsertProject(first);
    await repository.upsertProject(second);
    await expect(repository.setProjectOrder([second.id, first.id])).resolves.toEqual([
      second,
      first,
    ]);
    await expect(repository.upsertProject({ ...first, name: "Renamed" })).resolves.toEqual({
      ...first,
      name: "Renamed",
    });
    await expect(repository.deleteProject(second.id)).resolves.toBe(true);
    await expect(repository.list()).resolves.toEqual([{ ...first, name: "Renamed" }]);
  });

  it("moves project settings to the Codex id without losing task history settings", async () => {
    const root = await createWorkspace();
    const projectRoot = join(root, "workspace");
    await mkdir(projectRoot);
    const repository = await openRepository(root);
    const legacyProject = createProject("legacy-local-id", "Workspace", projectRoot);
    const codexProject = { ...legacyProject, id: "codex-project-id" };
    await repository.upsertProject(legacyProject);
    await repository.writeProjectDefaults(legacyProject.id, {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      fastMode: true,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    await repository.writeTaskSettings(legacyProject.id, "legacy-task", {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });

    await expect(repository.migrateProject(legacyProject.id, codexProject)).resolves.toEqual(
      codexProject,
    );
    await expect(repository.read(legacyProject.id)).resolves.toBeUndefined();
    await expect(repository.readProjectDefaults(codexProject.id)).resolves.toMatchObject({
      model: "gpt-5.6-sol",
    });
    await expect(
      repository.readTaskSettings(codexProject.id, "legacy-task"),
    ).resolves.toMatchObject({ approvalPolicy: "never" });
  });

  it("persists the one-time project source migration state", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);

    await expect(repository.readProjectSourceMigration()).resolves.toEqual({
      completed: false,
      recoverUnassigned: false,
    });
    await repository.completeProjectSourceMigration();
    await expect(repository.readProjectSourceMigration()).resolves.toEqual({
      completed: true,
      recoverUnassigned: false,
    });
  });

  it("enables unassigned thread recovery only when upgrading an existing version 14 database", async () => {
    const root = await createWorkspace();
    const version14 = await openRepository(root, {
      migrations: SQLITE_MIGRATIONS.filter((migration) => migration.version <= 14),
    });
    await version14.close();
    repositories.splice(repositories.indexOf(version14), 1);

    const upgraded = await openRepository(root);

    await expect(upgraded.readProjectSourceMigration()).resolves.toEqual({
      completed: false,
      recoverUnassigned: true,
    });
  });

  it("reopens recovery after version 15 incorrectly completed without vscode threads", async () => {
    const root = await createWorkspace();
    const version14 = await openRepository(root, {
      migrations: SQLITE_MIGRATIONS.filter((migration) => migration.version <= 14),
    });
    await version14.close();
    repositories.splice(repositories.indexOf(version14), 1);

    const brokenVersion15 = await openRepository(root, {
      migrations: SQLITE_MIGRATIONS.filter((migration) => migration.version <= 15),
    });
    await brokenVersion15.completeProjectSourceMigration();
    await brokenVersion15.close();
    repositories.splice(repositories.indexOf(brokenVersion15), 1);

    const repaired = await openRepository(root);

    await expect(repaired.readProjectSourceMigration()).resolves.toEqual({
      completed: false,
      recoverUnassigned: true,
    });
  });
});
