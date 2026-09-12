export function createProjectTodoOperations(database) {
  if (
    !database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_todos'")
      .get()
  )
    return {};
  const list = database.prepare(
    "SELECT record_json FROM project_todos WHERE project_id = ? ORDER BY updated_at DESC, id",
  );
  const read = database.prepare(
    "SELECT version FROM project_todos WHERE project_id = ? AND id = ?",
  );
  const write =
    database.prepare(`INSERT INTO project_todos (project_id, id, version, updated_at, record_json) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, record_json = excluded.record_json`);
  const remove = database.prepare("DELETE FROM project_todos WHERE project_id = ? AND id = ?");
  const removeAttachments = database.prepare(
    "DELETE FROM project_todo_attachments WHERE project_id = ? AND todo_id = ?",
  );
  const writeAttachment = database.prepare(
    "INSERT INTO project_todo_attachments (project_id, todo_id, attachment_id, metadata, content) VALUES (?, ?, ?, ?, ?)",
  );
  const readAttachment = database.prepare(
    "SELECT metadata, content FROM project_todo_attachments WHERE project_id = ? AND attachment_id = ? LIMIT 1",
  );
  return {
    listProjectTodos: ({ projectId }) => list.all(projectId).map((row) => row.record_json),
    readProjectTodoAttachment: ({ projectId, attachmentId }) =>
      readAttachment.get(projectId, attachmentId),
    saveProjectTodo: database.transaction(({ todo, expectedVersion, attachments }) => {
      if ((read.get(todo.projectId, todo.id)?.version ?? null) !== expectedVersion) return false;
      // 正式待办有明确数量上限，避免每次列表读取无限增长。
      if (expectedVersion === null && list.all(todo.projectId).length >= 1000)
        throw new Error("Project todo capacity is exhausted");
      write.run(todo.projectId, todo.id, todo.version, todo.updatedAt, JSON.stringify(todo));
      removeAttachments.run(todo.projectId, todo.id);
      for (const { attachment, content } of attachments)
        writeAttachment.run(
          todo.projectId,
          todo.id,
          attachment.id,
          JSON.stringify(attachment),
          content,
        );
      return true;
    }),
    deleteProjectTodo: database.transaction(({ projectId, todoId, expectedVersion }) => {
      const current = read.get(projectId, todoId);
      if (current === undefined) return false;
      if (current.version !== expectedVersion) return null;
      remove.run(projectId, todoId);
      return true;
    }),
  };
}
