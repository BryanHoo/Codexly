export const PROJECT_TODO_MIGRATION = {
  version: 28,
  name: "persist_project_todos",
  sql: `CREATE TABLE project_todos (
    project_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, record_json TEXT NOT NULL,
    PRIMARY KEY (project_id, id)
  ) STRICT;
  CREATE TABLE project_todo_attachments (
    project_id TEXT NOT NULL, todo_id TEXT NOT NULL, attachment_id TEXT NOT NULL,
    metadata TEXT NOT NULL, content BLOB NOT NULL,
    PRIMARY KEY (project_id, todo_id, attachment_id),
    FOREIGN KEY (project_id, todo_id) REFERENCES project_todos(project_id, id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX project_todo_attachment_lookup ON project_todo_attachments(project_id, attachment_id);
  CREATE TRIGGER delete_project_todos AFTER DELETE ON projects BEGIN
    DELETE FROM project_todos WHERE project_id = OLD.id;
  END;`,
} as const;
