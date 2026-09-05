export function createScheduledTaskOperations(database) {
  const available = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("scheduled_task_state");
  if (available === undefined) return {};
  const read = database.prepare("SELECT tasks_json FROM scheduled_task_state WHERE id = 1");
  const write = database.prepare(`
    INSERT INTO scheduled_task_state (id, tasks_json) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET tasks_json = excluded.tasks_json
  `);
  const deleteAttachments = database.prepare(
    "DELETE FROM scheduled_task_attachments WHERE task_id = ?",
  );
  const insertAttachment = database.prepare(`
    INSERT INTO scheduled_task_attachments (
      task_id, attachment_id, project_id, kind, media_type, name, size, content
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listAttachments = database.prepare(
    "SELECT * FROM scheduled_task_attachments WHERE task_id = ? ORDER BY attachment_id",
  );
  const readAttachment = database.prepare(`
    SELECT * FROM scheduled_task_attachments
    WHERE project_id = ? AND attachment_id = ?
    LIMIT 1
  `);
  const replaceAttachments = database.transaction((payload) => {
    deleteAttachments.run(payload.taskId);
    for (const item of payload.attachments) {
      insertAttachment.run(
        payload.taskId,
        item.attachment.id,
        payload.projectId,
        item.attachment.kind,
        item.attachment.mediaType,
        item.attachment.name,
        item.attachment.size,
        item.content,
      );
    }
  });

  return {
    deleteScheduledTaskAttachments(payload) {
      deleteAttachments.run(payload.taskId);
      return null;
    },
    listScheduledTaskAttachments(payload) {
      return listAttachments.all(payload.taskId);
    },
    readScheduledTasks() {
      return read.get()?.tasks_json ?? "[]";
    },
    readScheduledTaskAttachment(payload) {
      return readAttachment.get(payload.projectId, payload.attachmentId);
    },
    replaceScheduledTaskAttachments(payload) {
      replaceAttachments(payload);
      return null;
    },
    writeScheduledTasks(payload) {
      write.run(payload.tasksJson);
      return null;
    },
  };
}
