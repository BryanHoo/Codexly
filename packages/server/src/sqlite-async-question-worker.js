export function createAsyncQuestionOperations(database) {
  if (
    !database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'async_questions'")
      .get()
  )
    return {};
  const list = database.prepare(
    // 同一回合的问题按发现顺序展示，不能按内容哈希重新排序。
    "SELECT record_json FROM async_questions WHERE project_id = ? AND task_id = ? ORDER BY json_extract(record_json, '$.group.createdAt'), rowid",
  );
  const read = database.prepare(
    "SELECT record_json FROM async_questions WHERE project_id = ? AND task_id = ? AND id = ?",
  );
  const insert = database.prepare(
    "INSERT OR IGNORE INTO async_questions (project_id, task_id, id, status, record_json) VALUES (?, ?, ?, 'pending', ?)",
  );
  const update = database.prepare(
    "UPDATE async_questions SET status = ?, record_json = ? WHERE project_id = ? AND task_id = ? AND id = ? AND status = ?",
  );
  const count = database.prepare(
    "SELECT COUNT(*) AS count FROM async_questions WHERE project_id = ? AND task_id = ?",
  );
  return {
    listAsyncQuestions: ({ projectId, taskId }) =>
      list.all(projectId, taskId).map((row) => row.record_json),
    discoverAsyncQuestions: database.transaction(({ projectId, taskId, groups }) => {
      // 重新读取历史只能补充发现记录，不能复活已经回答或忽略的问题。
      for (const group of groups)
        insert.run(projectId, taskId, group.id, JSON.stringify({ group }));
      if (count.get(projectId, taskId).count > 10000)
        throw new Error("Async question capacity is exhausted");
      return null;
    }),
    updateAsyncQuestion: ({ projectId, taskId, record, expectedStatus }) =>
      update.run(
        record.group.status,
        JSON.stringify(record),
        projectId,
        taskId,
        record.group.id,
        expectedStatus,
      ).changes === 1,
    dismissAsyncQuestions: database.transaction(({ projectId, taskId, ids }) => {
      for (const id of ids) {
        const row = read.get(projectId, taskId, id);
        if (row === undefined) continue;
        const record = JSON.parse(row.record_json);
        record.group.status = "dismissed";
        // 回答请求已占用的问题不能被并发关闭覆盖。
        update.run("dismissed", JSON.stringify(record), projectId, taskId, id, "pending");
      }
      return null;
    }),
  };
}
