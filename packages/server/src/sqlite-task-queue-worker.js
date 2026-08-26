function queueRecord(row) {
  return {
    clientUserMessageId: row.client_user_message_id,
    id: row.id,
    inputJson: row.input_json,
    projectId: row.project_id,
    status: row.status,
    taskId: row.task_id,
  };
}

export function createTaskQueueOperations(database) {
  let statements;
  const getStatements = () => {
    if (statements !== undefined) return statements;
    const list = database.prepare(`
      SELECT project_id, task_id, id, client_user_message_id, input_json, status
      FROM task_queue WHERE project_id = ? AND task_id = ? ORDER BY position
    `);
    const move = database.prepare(
      "UPDATE task_queue SET position = ? WHERE project_id = ? AND task_id = ? AND id = ?",
    );
    const reorder = database.transaction((projectId, taskId, queuedSubmissionIds) => {
      const currentIds = list.all(projectId, taskId).map((row) => row.id);
      const requestedIds = new Set(queuedSubmissionIds);
      if (
        currentIds.length !== queuedSubmissionIds.length ||
        requestedIds.size !== currentIds.length ||
        currentIds.some((id) => !requestedIds.has(id))
      ) {
        throw new Error("Task queue order must contain every queued submission exactly once");
      }
      // 先移入负数区间，避免交换顺序时触发 position 唯一约束。
      queuedSubmissionIds.forEach((id, index) => move.run(-index - 1, projectId, taskId, id));
      queuedSubmissionIds.forEach((id, index) => move.run(index, projectId, taskId, id));
    });
    statements = {
      insert: database.prepare(`
        INSERT INTO task_queue (
          project_id, task_id, id, client_user_message_id, input_json, status, position, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, (
          SELECT COALESCE(MAX(position) + 1, 0)
          FROM task_queue WHERE project_id = ? AND task_id = ?
        ), ?)
      `),
      list,
      remove: database.prepare(
        "DELETE FROM task_queue WHERE project_id = ? AND task_id = ? AND id = ?",
      ),
      reorder,
      update: database.prepare(`
        UPDATE task_queue SET input_json = ?, status = ?, updated_at = ?
        WHERE project_id = ? AND task_id = ? AND id = ?
      `),
    };
    return statements;
  };

  return {
    addTaskQueueRecord(payload) {
      const { insert, list } = getStatements();
      insert.run(
        payload.projectId,
        payload.taskId,
        payload.id,
        payload.clientUserMessageId,
        payload.inputJson,
        payload.status,
        payload.projectId,
        payload.taskId,
        payload.updatedAt,
      );
      return list
        .all(payload.projectId, payload.taskId)
        .map(queueRecord)
        .find((record) => record.id === payload.id);
    },
    deleteTaskQueueRecord(payload) {
      const { remove } = getStatements();
      return remove.run(payload.projectId, payload.taskId, payload.queuedSubmissionId).changes > 0;
    },
    listTaskQueueRecords(payload) {
      const { list } = getStatements();
      return list.all(payload.projectId, payload.taskId).map(queueRecord);
    },
    reorderTaskQueueRecords(payload) {
      const { reorder } = getStatements();
      reorder(payload.projectId, payload.taskId, payload.queuedSubmissionIds);
      return null;
    },
    updateTaskQueueRecord(payload) {
      const { list, update } = getStatements();
      const changed = update.run(
        payload.inputJson,
        payload.status,
        payload.updatedAt,
        payload.projectId,
        payload.taskId,
        payload.queuedSubmissionId,
      ).changes;
      if (changed === 0) return undefined;
      return list
        .all(payload.projectId, payload.taskId)
        .map(queueRecord)
        .find((record) => record.id === payload.queuedSubmissionId);
    },
  };
}
