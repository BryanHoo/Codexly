export function createSubmissionOperations(database) {
  if (
    !database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_submissions'")
      .get()
  )
    return {};
  const read = database.prepare(
    "SELECT record_json FROM task_submissions WHERE project_id = ? AND submission_key = ?",
  );
  const count = database.prepare("SELECT COUNT(*) AS count FROM task_submissions");
  const prune = database.prepare(
    "DELETE FROM task_submissions WHERE completed = 1 AND updated_at < ?",
  );
  const write =
    database.prepare(`INSERT INTO task_submissions (project_id, submission_key, record_json, completed, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, submission_key) DO UPDATE SET
    record_json = excluded.record_json, completed = excluded.completed, updated_at = excluded.updated_at`);
  return {
    readSubmission({ projectId, key }) {
      return read.get(projectId, key)?.record_json;
    },
    writeSubmission: database.transaction(({ projectId, key, recordJson, completed }) => {
      // 仅清理七天前的完成记录；未知执行状态不能因缓存淘汰而被重投递。
      const now = Date.now();
      prune.run(now - 7 * 24 * 60 * 60 * 1000);
      if (!read.get(projectId, key) && count.get().count >= 10000)
        throw new Error("Submission recovery capacity is exhausted");
      write.run(projectId, key, recordJson, completed ? 1 : 0, now);
      return null;
    }),
  };
}
