export const ASYNC_QUESTION_MIGRATION = {
  version: 29,
  name: "persist_async_question_state",
  sql: `CREATE TABLE async_questions (
    project_id TEXT NOT NULL, task_id TEXT NOT NULL, id TEXT NOT NULL,
    status TEXT NOT NULL, record_json TEXT NOT NULL,
    PRIMARY KEY (project_id, task_id, id)
  ) STRICT;
  CREATE TRIGGER delete_project_async_questions AFTER DELETE ON projects BEGIN
    DELETE FROM async_questions WHERE project_id = OLD.id;
  END;`,
} as const;
