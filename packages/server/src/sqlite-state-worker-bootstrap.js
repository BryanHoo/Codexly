import { deserializeApprovalPolicy } from "./approval-policy-persistence.js";

export function projectFromRows(row, rootRows) {
  if (row === undefined) {
    return undefined;
  }
  const roots = rootRows.map((root) => ({ id: root.root_id, path: root.path }));
  if (roots.length === 0) {
    throw new Error(`Project ${row.id} has no stored roots`);
  }
  return {
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    roots,
  };
}

export function projectsFromRows(projectRows, rootRows) {
  const rootsByProject = new Map();
  for (const root of rootRows) {
    const roots = rootsByProject.get(root.project_id) ?? [];
    roots.push(root);
    rootsByProject.set(root.project_id, roots);
  }
  return projectRows.map((project) =>
    projectFromRows(project, rootsByProject.get(project.id) ?? []),
  );
}

export function projectDefaultsFromRow(row) {
  if (row === undefined) {
    return undefined;
  }
  return {
    approvalPolicy: deserializeApprovalPolicy(row.approval_policy, "turn"),
    approvalsReviewer: row.approvals_reviewer,
    fastMode: row.fast_mode === 1,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    sandboxMode: row.sandbox_mode,
  };
}

export function taskSettingsFromRow(row) {
  if (row === undefined) {
    return undefined;
  }
  return {
    approvalPolicy: deserializeApprovalPolicy(row.approval_policy, "turn"),
    approvalsReviewer: row.approvals_reviewer,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    sandboxMode: row.sandbox_mode,
  };
}

export function globalSettingsFromRow(row) {
  if (row === undefined) {
    return undefined;
  }
  return {
    approvalPolicy: deserializeApprovalPolicy(row.approval_policy, "global"),
    approvalsReviewer: row.approvals_reviewer,
    commitMessageModel: row.commit_message_model,
    commitMessagePrompt: row.commit_message_prompt,
    defaultOpenAppId: row.default_open_app_id,
    fastMode: row.fast_mode === 1,
    followUpBehavior: row.follow_up_behavior,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    sandboxMode: row.sandbox_mode,
  };
}

export function providerConnectionFromRow(row) {
  if (row === undefined) {
    return undefined;
  }
  return {
    customBaseUrl: row.custom_base_url,
    customModelsJson: row.custom_models_json,
    mode: row.mode,
    updatedAt: row.updated_at,
  };
}

export function hasTable(database, tableName) {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) !== undefined
  );
}

export function configureDatabase(database) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("synchronous = NORMAL");
  database.pragma("busy_timeout = 5000");
}

export function readMigrationVersion(database) {
  if (!hasTable(database, "schema_migrations")) {
    return 0;
  }
  return database
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get().version;
}

export function runMigrations(database, migrations, onMigrationApplied = () => {}) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const applied = new Set(
    database
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );
  let previousVersion = 0;
  for (const migration of migrations) {
    if (
      !Number.isInteger(migration.version) ||
      migration.version <= previousVersion ||
      typeof migration.name !== "string" ||
      typeof migration.sql !== "string"
    ) {
      throw new Error("Invalid SQLite migration definition");
    }
    previousVersion = migration.version;
    if (applied.has(migration.version)) {
      continue;
    }
    // DDL 与版本记录必须同事务提交，失败时数据库仍停留在上一个完整版本。
    database.transaction(() => {
      database.exec(migration.sql);
      onMigrationApplied(migration.version);
      database
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}

export function initializeProjectSourceMigration(database, previousMigrationVersion) {
  if (!hasTable(database, "project_source_migration")) {
    return;
  }
  // 只有已经运行过破坏性 v14 的数据库才需要从未分配 Thread 反推丢失项目。
  database
    .prepare(
      `INSERT OR IGNORE INTO project_source_migration
       (id, completed, recover_unassigned) VALUES (1, 0, ?)`,
    )
    .run(previousMigrationVersion === 14 ? 1 : 0);
}

export function ensureGlobalSettingsCompatibility(database) {
  if (!hasTable(database, "global_settings")) {
    return;
  }
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(global_settings)")
      .all()
      .map((column) => column.name),
  );
  database.transaction(() => {
    // 版本切换不能依赖迁移记录推断实际列，准备语句前必须修复持久化契约。
    if (!columns.has("fast_mode")) {
      database.exec(`
        ALTER TABLE global_settings
          ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0
          CHECK (fast_mode IN (0, 1));
      `);
    }
    if (!columns.has("commit_message_reasoning_effort")) {
      database.exec(`
        ALTER TABLE global_settings
          ADD COLUMN commit_message_reasoning_effort TEXT NOT NULL DEFAULT '';
        UPDATE global_settings
        SET commit_message_reasoning_effort = reasoning_effort;
      `);
    }
  })();
}
