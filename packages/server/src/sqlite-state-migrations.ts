import {
  GLOBAL_SETTINGS_MIGRATIONS,
  WORKBENCH_PET_SETTINGS_MIGRATION,
} from "./global-settings-persistence.js";
import { PROVIDER_CONNECTION_MIGRATION } from "./provider-connection-persistence.js";

export type SqliteMigration = Readonly<{
  name: string;
  sql: string;
  version: number;
}>;

export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    name: "create_local_state",
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE project_defaults (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE task_settings (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        approval_policy TEXT NOT NULL CHECK (approval_policy IN ('untrusted', 'on-request', 'never')),
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id)
      ) STRICT;
    `,
    version: 1,
  },
  {
    name: "create_task_metadata",
    sql: `
      CREATE TABLE task_metadata (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id)
      ) STRICT;
    `,
    version: 2,
  },
  {
    name: "add_sandbox_mode_settings",
    sql: `
      ALTER TABLE project_defaults
        ADD COLUMN sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write'
        CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access'));
      ALTER TABLE task_settings
        ADD COLUMN sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write'
        CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access'));
    `,
    version: 3,
  },
  {
    name: "add_project_sort_order",
    sql: `
      ALTER TABLE projects
        ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
    `,
    version: 4,
  },
  {
    name: "add_approvals_reviewer_setting",
    sql: `
      ALTER TABLE task_settings
        ADD COLUMN approvals_reviewer TEXT NOT NULL DEFAULT 'user'
        CHECK (
          approvals_reviewer IN ('user', 'auto_review')
          AND (approvals_reviewer = 'user' OR approval_policy = 'on-request')
        );
    `,
    version: 5,
  },
  {
    name: "create_global_settings",
    sql: `
      CREATE TABLE global_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        approval_policy TEXT NOT NULL CHECK (approval_policy IN ('untrusted', 'on-request', 'never')),
        approvals_reviewer TEXT NOT NULL CHECK (
          approvals_reviewer IN ('user', 'auto_review')
          AND (approvals_reviewer = 'user' OR approval_policy = 'on-request')
        ),
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access')),
        default_open_app_id TEXT CHECK (default_open_app_id IN (
          'visual-studio-code', 'zed', 'windsurf', 'finder', 'terminal', 'ghostty', 'xcode',
          'android-studio', 'file-manager', 'gnome-terminal', 'konsole', 'xfce-terminal',
          'explorer', 'windows-terminal', 'command-prompt'
        )),
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
    version: 6,
  },
  {
    name: "add_commit_message_settings",
    sql: `
      ALTER TABLE global_settings
        ADD COLUMN commit_message_model TEXT NOT NULL DEFAULT '';
      ALTER TABLE global_settings
        ADD COLUMN commit_message_reasoning_effort TEXT NOT NULL DEFAULT '';
      ALTER TABLE global_settings
        ADD COLUMN commit_message_prompt TEXT NOT NULL DEFAULT '';

      -- 现有用户继承原 Agent 模型，升级后无需重新选择即可继续生成提交信息。
      UPDATE global_settings
      SET commit_message_model = model,
          commit_message_reasoning_effort = reasoning_effort;
    `,
    version: 7,
  },
  {
    name: "add_follow_up_behavior_setting",
    sql: `
      ALTER TABLE global_settings
        ADD COLUMN follow_up_behavior TEXT NOT NULL DEFAULT 'queue'
        CHECK (follow_up_behavior IN ('queue', 'steer'));
    `,
    version: 8,
  },
  {
    name: "drop_task_metadata",
    sql: "DROP TABLE task_metadata;",
    version: 9,
  },
  {
    name: "add_project_kind",
    sql: `
      ALTER TABLE projects
        ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'
        CHECK (kind IN ('user', 'temporary'));
    `,
    version: 10,
  },
  PROVIDER_CONNECTION_MIGRATION,
  ...GLOBAL_SETTINGS_MIGRATIONS,
  {
    name: "use_codex_project_identity",
    sql: `
      CREATE TABLE projects_projection (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'temporary'))
      ) STRICT;

      CREATE TABLE project_defaults_projection (
        project_id TEXT PRIMARY KEY REFERENCES projects_projection(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write'
          CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access'))
      ) STRICT;

      CREATE TABLE task_settings_projection (
        project_id TEXT NOT NULL REFERENCES projects_projection(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        approval_policy TEXT NOT NULL CHECK (approval_policy IN ('untrusted', 'on-request', 'never')),
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write'
          CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access')),
        approvals_reviewer TEXT NOT NULL DEFAULT 'user'
          CHECK (
            approvals_reviewer IN ('user', 'auto_review')
            AND (approvals_reviewer = 'user' OR approval_policy = 'on-request')
          ),
        PRIMARY KEY (project_id, task_id)
      ) STRICT;

      INSERT INTO projects_projection
        (id, name, root_path, created_at, sort_order, kind)
      SELECT id, name, root_path, created_at, sort_order, kind FROM projects;
      INSERT INTO project_defaults_projection
        (project_id, model, reasoning_effort, updated_at, sandbox_mode)
      SELECT project_id, model, reasoning_effort, updated_at, sandbox_mode FROM project_defaults;
      INSERT INTO task_settings_projection
        (project_id, task_id, approval_policy, model, reasoning_effort, updated_at,
         sandbox_mode, approvals_reviewer)
      SELECT project_id, task_id, approval_policy, model, reasoning_effort, updated_at,
             sandbox_mode, approvals_reviewer
      FROM task_settings;

      DROP TABLE task_settings;
      DROP TABLE project_defaults;
      DROP TABLE projects;
      ALTER TABLE projects_projection RENAME TO projects;
      ALTER TABLE project_defaults_projection RENAME TO project_defaults;
      ALTER TABLE task_settings_projection RENAME TO task_settings;
    `,
    version: 14,
  },
  {
    name: "track_project_source_migration",
    sql: `
      CREATE TABLE project_source_migration (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
        recover_unassigned INTEGER NOT NULL CHECK (recover_unassigned IN (0, 1))
      ) STRICT;
    `,
    version: 15,
  },
  {
    name: "retry_project_source_migration_with_vscode_threads",
    // v15 错把 App Server 普通 Thread 来源识别为 appServer，需要对所有已完成状态重试一次。
    sql: "UPDATE project_source_migration SET completed = 0;",
    version: 16,
  },
  {
    name: "store_task_settings_by_scope",
    sql: `
      CREATE TABLE task_scope_settings (
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        approval_policy TEXT NOT NULL CHECK (approval_policy IN ('untrusted', 'on-request', 'never')),
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write'
          CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access')),
        approvals_reviewer TEXT NOT NULL DEFAULT 'user'
          CHECK (
            approvals_reviewer IN ('user', 'auto_review')
            AND (approvals_reviewer = 'user' OR approval_policy = 'on-request')
          ),
        PRIMARY KEY (project_id, task_id)
      ) STRICT;

      INSERT INTO task_scope_settings
        (project_id, task_id, approval_policy, model, reasoning_effort, updated_at,
         sandbox_mode, approvals_reviewer)
      SELECT project_id, task_id, approval_policy, model, reasoning_effort, updated_at,
             sandbox_mode, approvals_reviewer
      FROM task_settings;

      DROP TABLE task_settings;
      ALTER TABLE task_scope_settings RENAME TO task_settings;
      DELETE FROM projects WHERE kind = 'temporary';
    `,
    version: 17,
  },
  {
    name: "store_ordered_project_roots",
    sql: `
      CREATE TABLE project_roots (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        path TEXT NOT NULL,
        PRIMARY KEY (project_id, position),
        UNIQUE (project_id, path)
      ) STRICT;

      INSERT INTO project_roots (project_id, position, path)
      SELECT id, 0, root_path FROM projects WHERE kind = 'user';

      ALTER TABLE projects DROP COLUMN root_path;
    `,
    version: 18,
  },
  {
    name: "store_stable_project_root_ids",
    sql: `
      CREATE TABLE project_roots_projection (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        root_id TEXT NOT NULL,
        path TEXT NOT NULL,
        PRIMARY KEY (project_id, position),
        UNIQUE (project_id, root_id),
        UNIQUE (project_id, path)
      ) STRICT;

      INSERT INTO project_roots_projection (project_id, position, root_id, path)
      SELECT project_id, position, project_id || ':' || position, path FROM project_roots;

      DROP TABLE project_roots;
      ALTER TABLE project_roots_projection RENAME TO project_roots;
    `,
    version: 19,
  },
  {
    name: "store_structured_approval_policies",
    sql: `
      CREATE TABLE task_settings_approval_v20 (
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        approval_policy TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write'
          CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access')),
        approvals_reviewer TEXT NOT NULL DEFAULT 'user'
          CHECK (approvals_reviewer IN ('user', 'auto_review')),
        PRIMARY KEY (project_id, task_id)
      ) STRICT;

      INSERT INTO task_settings_approval_v20
        (project_id, task_id, approval_policy, model, reasoning_effort, updated_at,
         sandbox_mode, approvals_reviewer)
      SELECT project_id, task_id, approval_policy, model, reasoning_effort, updated_at,
             sandbox_mode, approvals_reviewer
      FROM task_settings;

      DROP TABLE task_settings;
      ALTER TABLE task_settings_approval_v20 RENAME TO task_settings;

      CREATE TABLE global_settings_approval_v20 (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        approval_policy TEXT NOT NULL,
        approvals_reviewer TEXT NOT NULL
          CHECK (approvals_reviewer IN ('user', 'auto_review')),
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL
          CHECK (sandbox_mode IN ('read-only', 'workspace-write', 'danger-full-access')),
        default_open_app_id TEXT CHECK (default_open_app_id IN (
          'visual-studio-code', 'zed', 'windsurf', 'finder', 'terminal', 'ghostty', 'xcode',
          'android-studio', 'file-manager', 'gnome-terminal', 'konsole', 'xfce-terminal',
          'explorer', 'windows-terminal', 'command-prompt'
        )),
        updated_at TEXT NOT NULL,
        commit_message_model TEXT NOT NULL DEFAULT '',
        commit_message_reasoning_effort TEXT NOT NULL DEFAULT '',
        commit_message_prompt TEXT NOT NULL DEFAULT '',
        follow_up_behavior TEXT NOT NULL DEFAULT 'queue'
          CHECK (follow_up_behavior IN ('queue', 'steer')),
        fast_mode INTEGER NOT NULL DEFAULT 0 CHECK (fast_mode IN (0, 1))
      ) STRICT;

      INSERT INTO global_settings_approval_v20
        (id, approval_policy, approvals_reviewer, model, reasoning_effort, sandbox_mode,
         default_open_app_id, updated_at, commit_message_model,
         commit_message_reasoning_effort, commit_message_prompt, follow_up_behavior, fast_mode)
      SELECT id,
             CASE approval_policy WHEN 'untrusted' THEN 'on-request' ELSE approval_policy END,
             approvals_reviewer, model, reasoning_effort, sandbox_mode, default_open_app_id,
             updated_at, commit_message_model, commit_message_reasoning_effort,
             commit_message_prompt, follow_up_behavior, fast_mode
      FROM global_settings;

      DROP TABLE global_settings;
      ALTER TABLE global_settings_approval_v20 RENAME TO global_settings;
    `,
    version: 20,
  },
  {
    name: "store_complete_project_task_defaults",
    sql: `
      ALTER TABLE project_defaults
        ADD COLUMN approval_policy TEXT NOT NULL DEFAULT 'on-request';
      ALTER TABLE project_defaults
        ADD COLUMN approvals_reviewer TEXT NOT NULL DEFAULT 'user'
        CHECK (approvals_reviewer IN ('user', 'auto_review'));
      ALTER TABLE project_defaults
        ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0
        CHECK (fast_mode IN (0, 1));
    `,
    version: 21,
  },
  {
    name: "persist_task_queue",
    sql: `
      CREATE TABLE task_queue (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        id TEXT NOT NULL,
        client_user_message_id TEXT NOT NULL,
        input_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('editing', 'queued')),
        position INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id, id),
        UNIQUE (project_id, task_id, position)
      ) STRICT;
    `,
    version: 22,
  },
  WORKBENCH_PET_SETTINGS_MIGRATION,
  {
    name: "allow_standalone_task_queue",
    sql: `
      CREATE TABLE task_scope_queue (
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        id TEXT NOT NULL,
        client_user_message_id TEXT NOT NULL,
        input_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('editing', 'queued')),
        position INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id, id),
        UNIQUE (project_id, task_id, position)
      ) STRICT;

      INSERT INTO task_scope_queue
        (project_id, task_id, id, client_user_message_id, input_json, status, position, updated_at)
      SELECT project_id, task_id, id, client_user_message_id, input_json, status, position, updated_at
      FROM task_queue;

      DROP TABLE task_queue;
      ALTER TABLE task_scope_queue RENAME TO task_queue;

      -- standalone Task 没有 Project 记录；真实 Project 删除时仍清理其持久队列。
      CREATE TRIGGER delete_project_task_queue
      AFTER DELETE ON projects
      BEGIN
        DELETE FROM task_queue WHERE project_id = OLD.id;
      END;
    `,
    version: 24,
  },
  {
    name: "persist_scheduled_tasks",
    sql: `
      CREATE TABLE scheduled_task_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        tasks_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE scheduled_task_attachments (
        task_id TEXT NOT NULL,
        attachment_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        media_type TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        content BLOB NOT NULL,
        PRIMARY KEY (task_id, attachment_id)
      ) STRICT;

      CREATE INDEX scheduled_task_attachments_lookup
      ON scheduled_task_attachments (project_id, attachment_id);
    `,
    version: 25,
  },
];
