import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import Database from "better-sqlite3";

import {
  configureDatabase,
  ensureGlobalSettingsCompatibility,
  globalSettingsFromRow,
  hasTable,
  initializeProjectSourceMigration,
  projectDefaultsFromRow,
  projectFromRows,
  projectsFromRows,
  providerConnectionFromRow,
  readMigrationVersion,
  runMigrations,
  taskSettingsFromRow,
} from "./sqlite-state-worker-bootstrap.js";
import { serializeApprovalPolicy } from "./approval-policy-persistence.js";
import { createTaskQueueOperations } from "./sqlite-task-queue-worker.js";
import { createScheduledTaskOperations } from "./sqlite-state-worker-scheduled-tasks.js";

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error",
  };
}
function createOperations(database) {
  const statements =
    hasTable(database, "projects") && hasTable(database, "project_roots")
      ? {
          upsertProject: database.prepare(
            `INSERT INTO projects (id, name, created_at, sort_order, kind)
           VALUES (?, ?, ?, (
             SELECT COALESCE(MAX(sort_order) + 1, 0) FROM projects WHERE kind = 'user'
           ), 'user')
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             created_at = excluded.created_at
           WHERE projects.kind = 'user'`,
          ),
          upsertProjectAtOrder: database.prepare(
            `INSERT INTO projects (id, name, created_at, sort_order, kind)
           VALUES (?, ?, ?, ?, 'user')
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             created_at = excluded.created_at,
             sort_order = excluded.sort_order
           WHERE projects.kind = 'user'`,
          ),
          listProjects: database.prepare(
            "SELECT id, name, created_at FROM projects WHERE kind = 'user' ORDER BY sort_order, created_at, id",
          ),
          listProjectRoots: database.prepare(
            `SELECT project_roots.project_id, project_roots.root_id, project_roots.path
           FROM project_roots
           JOIN projects ON projects.id = project_roots.project_id
           WHERE projects.kind = 'user'
           ORDER BY projects.sort_order, projects.created_at, projects.id, project_roots.position`,
          ),
          listProjectIds: database.prepare(
            "SELECT id FROM projects WHERE kind = 'user' ORDER BY sort_order, created_at, id",
          ),
          readProject: database.prepare("SELECT id, name, created_at FROM projects WHERE id = ?"),
          readProjectWithOrder: database.prepare(
            "SELECT id, name, created_at, sort_order FROM projects WHERE id = ? AND kind = 'user'",
          ),
          readProjectRoots: database.prepare(
            "SELECT project_id, root_id, path FROM project_roots WHERE project_id = ? ORDER BY position",
          ),
          removeProjectRoots: database.prepare("DELETE FROM project_roots WHERE project_id = ?"),
          writeProjectRoot: database.prepare(
            "INSERT INTO project_roots (project_id, position, root_id, path) VALUES (?, ?, ?, ?)",
          ),
          removeProject: database.prepare("DELETE FROM projects WHERE id = ? AND kind = 'user'"),
          copyProjectDefaults: database.prepare(
            `INSERT INTO project_defaults
             (project_id, model, reasoning_effort, updated_at, sandbox_mode,
              approval_policy, approvals_reviewer, fast_mode)
           SELECT ?, model, reasoning_effort, updated_at, sandbox_mode,
                  approval_policy, approvals_reviewer, fast_mode
           FROM project_defaults WHERE project_id = ?
           ON CONFLICT(project_id) DO UPDATE SET
             model = excluded.model,
             reasoning_effort = excluded.reasoning_effort,
             updated_at = excluded.updated_at,
             sandbox_mode = excluded.sandbox_mode,
             approval_policy = excluded.approval_policy,
             approvals_reviewer = excluded.approvals_reviewer,
             fast_mode = excluded.fast_mode`,
          ),
          copyTaskSettings: database.prepare(
            `INSERT INTO task_settings
             (project_id, task_id, approval_policy, model, reasoning_effort, updated_at,
              sandbox_mode, approvals_reviewer)
           SELECT ?, task_id, approval_policy, model, reasoning_effort, updated_at,
                  sandbox_mode, approvals_reviewer
           FROM task_settings WHERE project_id = ?
           ON CONFLICT(project_id, task_id) DO UPDATE SET
             approval_policy = excluded.approval_policy,
             model = excluded.model,
             reasoning_effort = excluded.reasoning_effort,
             updated_at = excluded.updated_at,
             sandbox_mode = excluded.sandbox_mode,
             approvals_reviewer = excluded.approvals_reviewer`,
          ),
          writeProjectSortOrder: database.prepare(
            "UPDATE projects SET sort_order = ? WHERE id = ? AND kind = 'user'",
          ),
          readProjectDefaults: database.prepare(
            `SELECT approval_policy, approvals_reviewer, fast_mode, model,
                    reasoning_effort, sandbox_mode
             FROM project_defaults WHERE project_id = ?`,
          ),
          readGlobalSettings: database.prepare(
            `SELECT approval_policy, approvals_reviewer, commit_message_model, commit_message_prompt,
                  model, reasoning_effort, sandbox_mode, default_open_app_id, fast_mode, follow_up_behavior, pet_enabled, pet_id
           FROM global_settings WHERE id = 1`,
          ),
          readProviderConnection: database.prepare(
            `SELECT mode, custom_base_url, custom_models_json, updated_at
           FROM provider_connection WHERE id = 1`,
          ),
          readTaskSettings: database.prepare(
            "SELECT approval_policy, approvals_reviewer, model, reasoning_effort, sandbox_mode FROM task_settings WHERE project_id = ? AND task_id = ?",
          ),
          writeProjectDefaults: database.prepare(`
      INSERT INTO project_defaults (
        project_id, approval_policy, approvals_reviewer, fast_mode, model,
        reasoning_effort, sandbox_mode, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        approval_policy = excluded.approval_policy,
        approvals_reviewer = excluded.approvals_reviewer,
        fast_mode = excluded.fast_mode,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        sandbox_mode = excluded.sandbox_mode,
        updated_at = excluded.updated_at
    `),
          writeGlobalSettings: database.prepare(`
      INSERT INTO global_settings (
        id, approval_policy, approvals_reviewer, commit_message_model, commit_message_prompt, model,
        reasoning_effort, sandbox_mode, default_open_app_id, fast_mode, follow_up_behavior, pet_enabled, pet_id, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        approval_policy = excluded.approval_policy,
        approvals_reviewer = excluded.approvals_reviewer,
        commit_message_model = excluded.commit_message_model,
        commit_message_prompt = excluded.commit_message_prompt,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        sandbox_mode = excluded.sandbox_mode,
        default_open_app_id = excluded.default_open_app_id,
        fast_mode = excluded.fast_mode,
        follow_up_behavior = excluded.follow_up_behavior,
        pet_enabled = excluded.pet_enabled, pet_id = excluded.pet_id,
        updated_at = excluded.updated_at
    `),
          writeProviderConnection: database.prepare(`
      INSERT INTO provider_connection (
        id, mode, custom_base_url, custom_models_json, updated_at
      ) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        mode = excluded.mode,
        custom_base_url = excluded.custom_base_url,
        custom_models_json = excluded.custom_models_json,
        updated_at = excluded.updated_at
    `),
          writeTaskSettings: database.prepare(`
      INSERT INTO task_settings (
        project_id, task_id, approval_policy, approvals_reviewer, model, reasoning_effort, sandbox_mode, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, task_id) DO UPDATE SET
        approval_policy = excluded.approval_policy,
        approvals_reviewer = excluded.approvals_reviewer,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        sandbox_mode = excluded.sandbox_mode,
        updated_at = excluded.updated_at
        `),
        }
      : undefined;
  function requireStatements() {
    if (statements === undefined) {
      throw new Error("SQLite state tables are unavailable");
    }
    return statements;
  }
  function readStoredProject(projectId) {
    const stateStatements = requireStatements();
    return projectFromRows(
      stateStatements.readProject.get(projectId),
      stateStatements.readProjectRoots.all(projectId),
    );
  }
  function readStoredProjects() {
    const stateStatements = requireStatements();
    return projectsFromRows(
      stateStatements.listProjects.all(),
      stateStatements.listProjectRoots.all(),
    );
  }

  function replaceStoredRoots(project) {
    const stateStatements = requireStatements();
    if (!Array.isArray(project.roots) || project.roots.length === 0) {
      throw new Error("Project roots must contain a primary root");
    }
    const rootIds = project.roots.map((root) => root.id);
    const paths = project.roots.map((root) => root.path);
    if (rootIds.some((rootId) => typeof rootId !== "string" || rootId.length === 0)) {
      throw new Error("Project root ids must be non-empty strings");
    }
    if (new Set(rootIds).size !== rootIds.length) {
      throw new Error("Project root ids must be unique");
    }
    if (paths.some((path) => typeof path !== "string" || path.length === 0)) {
      throw new Error("Project root paths must be non-empty strings");
    }
    if (new Set(paths).size !== paths.length) {
      throw new Error("Project root paths must be unique");
    }
    stateStatements.removeProjectRoots.run(project.id);
    paths.forEach((path, position) => {
      stateStatements.writeProjectRoot.run(project.id, position, rootIds[position], path);
    });
  }

  const reorderProjects = database.transaction((projectIds) => {
    const stateStatements = requireStatements();
    const storedProjectIds = stateStatements.listProjectIds.all().map((row) => row.id);
    const requestedProjectIds = new Set(projectIds);
    const containsCompleteProjectSet =
      projectIds.length === storedProjectIds.length &&
      requestedProjectIds.size === storedProjectIds.length &&
      storedProjectIds.every((projectId) => requestedProjectIds.has(projectId));
    if (!containsCompleteProjectSet) {
      throw new Error("Project order must contain every project exactly once");
    }

    // 完整顺序在同一事务内替换，读取方不会观察到部分重排。
    projectIds.forEach((projectId, sortOrder) => {
      stateStatements.writeProjectSortOrder.run(sortOrder, projectId);
    });
    return readStoredProjects();
  });

  const replaceProjects = database.transaction((projects) => {
    const stateStatements = requireStatements();
    const projectIds = new Set(projects.map((project) => project.id));
    if (projectIds.size !== projects.length) {
      throw new Error("Project projection must contain unique project ids");
    }
    for (const { id } of stateStatements.listProjectIds.all()) {
      if (!projectIds.has(id)) {
        stateStatements.removeProject.run(id);
      }
    }
    projects.forEach((project, sortOrder) => {
      stateStatements.upsertProjectAtOrder.run(
        project.id,
        project.name,
        project.createdAt,
        sortOrder,
      );
      replaceStoredRoots(project);
    });
    return readStoredProjects();
  });

  const migrateProject = database.transaction((legacyProjectId, project) => {
    const stateStatements = requireStatements();
    const legacy = stateStatements.readProjectWithOrder.get(legacyProjectId);
    const sortOrder = legacy?.sort_order ?? stateStatements.listProjectIds.all().length;
    stateStatements.upsertProjectAtOrder.run(
      project.id,
      project.name,
      project.createdAt,
      sortOrder,
    );
    replaceStoredRoots(project);
    if (legacyProjectId !== project.id && legacy !== undefined) {
      stateStatements.copyProjectDefaults.run(project.id, legacyProjectId);
      stateStatements.copyTaskSettings.run(project.id, legacyProjectId);
      stateStatements.removeProject.run(legacyProjectId);
    }
    const stored = readStoredProject(project.id);
    if (stored === undefined) {
      throw new Error("Migrated Project projection could not be stored");
    }
    return stored;
  });

  const projectSourceMigrationStatements = hasTable(database, "project_source_migration")
    ? {
        complete: database.prepare(
          "UPDATE project_source_migration SET completed = 1 WHERE id = 1",
        ),
        read: database.prepare(
          "SELECT completed, recover_unassigned FROM project_source_migration WHERE id = 1",
        ),
      }
    : undefined;

  return {
    ...createTaskQueueOperations(database),
    ...createScheduledTaskOperations(database),
    diagnose() {
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (-1, 'doctor', ?)",
          )
          .run(new Date().toISOString());
      } finally {
        database.exec("ROLLBACK");
      }
      const synchronousValue = database.pragma("synchronous", { simple: true });
      return {
        busyTimeout: database.pragma("busy_timeout", { simple: true }),
        foreignKeys: database.pragma("foreign_keys", { simple: true }) === 1,
        integrityCheck: database.pragma("integrity_check", { simple: true }),
        journalMode: database.pragma("journal_mode", { simple: true }),
        migrationVersion: database
          .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
          .get().version,
        synchronous: synchronousValue === 1 ? "normal" : String(synchronousValue),
        writable: true,
      };
    },
    completeProjectSourceMigration() {
      if (projectSourceMigrationStatements === undefined) {
        throw new Error("Project source migration state is unavailable");
      }
      projectSourceMigrationStatements.complete.run();
      return null;
    },
    listProjects() {
      return readStoredProjects();
    },
    readProject(payload) {
      return readStoredProject(payload.projectId);
    },
    readProjectSourceMigration() {
      if (projectSourceMigrationStatements === undefined) {
        throw new Error("Project source migration state is unavailable");
      }
      const row = projectSourceMigrationStatements.read.get();
      if (row === undefined) {
        throw new Error("Project source migration state is missing");
      }
      return {
        completed: row.completed === 1,
        recoverUnassigned: row.recover_unassigned === 1,
      };
    },
    replaceProjects(payload) {
      return replaceProjects(payload.projects);
    },
    upsertProject(payload) {
      return database.transaction((project) => {
        const stateStatements = requireStatements();
        stateStatements.upsertProject.run(project.id, project.name, project.createdAt);
        replaceStoredRoots(project);
        const stored = readStoredProject(project.id);
        if (stored === undefined) {
          throw new Error("Project projection could not be stored");
        }
        return stored;
      })(payload.project);
    },
    migrateProject(payload) {
      return migrateProject(payload.legacyProjectId, payload.project);
    },
    deleteProject(payload) {
      return requireStatements().removeProject.run(payload.projectId).changes > 0;
    },
    setProjectOrder(payload) {
      return reorderProjects(payload.projectIds);
    },
    readProjectDefaults(payload) {
      return projectDefaultsFromRow(requireStatements().readProjectDefaults.get(payload.projectId));
    },
    readGlobalSettings() {
      return globalSettingsFromRow(requireStatements().readGlobalSettings.get());
    },
    readProviderConnection() {
      return providerConnectionFromRow(requireStatements().readProviderConnection.get());
    },
    readTaskSettings(payload) {
      return taskSettingsFromRow(
        requireStatements().readTaskSettings.get(payload.projectId, payload.taskId),
      );
    },
    writeProjectDefaults(payload) {
      const settings = payload.settings;
      requireStatements().writeProjectDefaults.run(
        payload.projectId,
        serializeApprovalPolicy(settings.approvalPolicy),
        settings.approvalsReviewer,
        settings.fastMode ? 1 : 0,
        settings.model,
        settings.reasoningEffort,
        settings.sandboxMode,
        payload.updatedAt,
      );
      return settings;
    },
    writeGlobalSettings(payload) {
      const settings = payload.settings;
      requireStatements().writeGlobalSettings.run(
        serializeApprovalPolicy(settings.approvalPolicy),
        settings.approvalsReviewer,
        settings.commitMessageModel,
        settings.commitMessagePrompt,
        settings.model,
        settings.reasoningEffort,
        settings.sandboxMode,
        settings.defaultOpenAppId,
        settings.fastMode ? 1 : 0,
        settings.followUpBehavior,
        settings.pet.enabled ? 1 : 0,
        settings.pet.selectedPetId,
        payload.updatedAt,
      );
      return settings;
    },
    writeProviderConnection(payload) {
      requireStatements().writeProviderConnection.run(
        payload.mode,
        payload.customBaseUrl,
        payload.customModelsJson,
        payload.updatedAt,
      );
      return null;
    },
    writeTaskSettings(payload) {
      const settings = payload.settings;
      requireStatements().writeTaskSettings.run(
        payload.projectId,
        payload.taskId,
        serializeApprovalPolicy(settings.approvalPolicy),
        settings.approvalsReviewer,
        settings.model,
        settings.reasoningEffort,
        settings.sandboxMode,
        payload.updatedAt,
      );
      return settings;
    },
  };
}

let database;
try {
  mkdirSync(resolve(workerData.databasePath, ".."), { recursive: true });
  database = new Database(workerData.databasePath);
  configureDatabase(database);
  const previousMigrationVersion = readMigrationVersion(database);
  runMigrations(database, workerData.migrations, (version) => {
    if (version === 15) {
      // 状态行与 v15 Schema 同事务提交，进程中断不会丢失灾后恢复标记。
      initializeProjectSourceMigration(database, previousMigrationVersion);
    }
  });
  initializeProjectSourceMigration(database, previousMigrationVersion);
  ensureGlobalSettingsCompatibility(database);
  const operations = createOperations(database);
  parentPort.on("message", (message) => {
    try {
      if (message.operation === "close") {
        database.close();
        parentPort.postMessage({ id: message.id, result: null, type: "response" });
        parentPort.close();
        return;
      }
      const operation = operations[message.operation];
      if (typeof operation !== "function") {
        throw new Error(`Unknown SQLite worker operation: ${String(message.operation)}`);
      }
      parentPort.postMessage({
        id: message.id,
        result: operation(message.payload),
        type: "response",
      });
    } catch (error) {
      parentPort.postMessage({ id: message.id, error: serializeError(error), type: "response" });
    }
  });
  parentPort.postMessage({ type: "ready" });
} catch (error) {
  database?.close();
  parentPort.postMessage({ error: serializeError(error), type: "fatal" });
  parentPort.close();
}
