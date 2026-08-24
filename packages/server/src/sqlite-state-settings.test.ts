import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  repositories,
  createProject,
  createWorkspace,
  openRepository,
} from "./sqlite-state-repository.test-support.js";

describe("SQLite settings state", () => {
  it("isolates project defaults and task settings across projects", async () => {
    const root = await createWorkspace();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const repository = await openRepository(root);
    const first = createProject("codex-first", "First", firstRoot);
    const second = createProject("codex-second", "Second", secondRoot);
    await repository.upsertProject(first);
    await repository.upsertProject(second);

    await repository.writeProjectDefaults(first.id, {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      fastMode: true,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    await repository.writeProjectDefaults(second.id, {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      fastMode: false,
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      sandboxMode: "read-only",
    });
    await repository.writeTaskSettings(first.id, "task-1", {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });
    await repository.writeTaskSettings(second.id, "task-1", {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      sandboxMode: "read-only",
    });

    await expect(repository.readProjectDefaults(first.id)).resolves.toEqual({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      fastMode: true,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    await expect(repository.readProjectDefaults(second.id)).resolves.toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      fastMode: false,
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      sandboxMode: "read-only",
    });
    await expect(repository.readTaskSettings(first.id, "task-1")).resolves.toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "user",
    });
    await expect(repository.readTaskSettings(second.id, "task-1")).resolves.toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    });
  });

  it("atomically replaces complete settings and restores them after reopening", async () => {
    const root = await createWorkspace();
    const projectRoot = join(root, "workspace");
    await mkdir(projectRoot);
    const repository = await openRepository(root);
    const project = createProject("codex-workspace", "Workspace", projectRoot);
    await repository.upsertProject(project);
    await repository.writeTaskSettings(project.id, "task-1", {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "old-model",
      reasoningEffort: "low",
      sandboxMode: "read-only",
    });
    await repository.writeTaskSettings(project.id, "task-1", {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      model: "new-model",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = await openRepository(root);

    await expect(reopened.readTaskSettings(project.id, "task-1")).resolves.toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      model: "new-model",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });
    await expect(reopened.read(project.id)).resolves.toEqual(project);
  });

  it("persists one complete global settings record across repository restarts", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    const settings = {
      approvalPolicy: "on-request" as const,
      approvalsReviewer: "auto_review" as const,
      commitMessageModel: "gpt-5.6-terra",
      commitMessagePrompt: "突出说明用户可见影响。",
      defaultOpenAppId: "visual-studio-code" as const,
      fastMode: true,
      followUpBehavior: "steer" as const,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write" as const,
    };

    await expect(repository.readGlobalSettings()).resolves.toBeUndefined();
    await expect(repository.writeGlobalSettings(settings)).resolves.toEqual(settings);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = await openRepository(root);
    await expect(reopened.readGlobalSettings()).resolves.toEqual(settings);
  });

  it("persists complete granular approval settings for global and task scopes", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    const approvalPolicy = {
      granular: {
        mcp_elicitations: false,
        request_permissions: true,
        rules: false,
        sandbox_approval: true,
        skill_approval: false,
      },
    } as const;
    const globalSettings = {
      approvalPolicy,
      approvalsReviewer: "user" as const,
      commitMessageModel: "gpt-5.6-terra",
      commitMessagePrompt: "",
      defaultOpenAppId: null,
      fastMode: false,
      followUpBehavior: "queue" as const,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write" as const,
    };
    const taskSettings = {
      approvalPolicy,
      approvalsReviewer: "auto_review" as const,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write" as const,
    };

    await expect(repository.writeGlobalSettings(globalSettings)).resolves.toEqual(globalSettings);
    await expect(
      repository.writeTaskSettings("temporary", "task-granular", taskSettings),
    ).resolves.toEqual(taskSettings);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = await openRepository(root);
    await expect(reopened.readGlobalSettings()).resolves.toEqual(globalSettings);
    await expect(reopened.readTaskSettings("temporary", "task-granular")).resolves.toEqual(
      taskSettings,
    );
  });

  it("repairs global settings columns required across version switches", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const repository = await openRepository(root);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const database = new Database(databasePath);
    try {
      // 模拟版本切换后迁移记录仍在、但新版字段被旧 Schema 移除的状态。
      database.exec("ALTER TABLE global_settings DROP COLUMN fast_mode;");
    } finally {
      database.close();
    }

    const reopened = await openRepository(root);
    await expect(reopened.readGlobalSettings()).resolves.toBeUndefined();
    await reopened.close();
    repositories.splice(repositories.indexOf(reopened), 1);

    const repairedDatabase = new Database(databasePath, { readonly: true });
    try {
      const columnNames = repairedDatabase
        .prepare("PRAGMA table_info(global_settings)")
        .all()
        .map((column) => (column as { name: string }).name);
      expect(columnNames).toEqual(
        expect.arrayContaining(["commit_message_reasoning_effort", "fast_mode"]),
      );
    } finally {
      repairedDatabase.close();
    }
  });
});
