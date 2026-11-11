export function createSubmissionOperations(database) {
  if (
    !database
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_submissions'")
      .get()
  )
    return {};
  // 恢复元数据独立保存，旧版本仍可按原严格 Schema 读取 record_json。
  database.exec(`CREATE TABLE IF NOT EXISTS acp_submission_intents (
    project_id TEXT NOT NULL, submission_key TEXT NOT NULL, engine TEXT NOT NULL, workspace_path TEXT,
    PRIMARY KEY(project_id,submission_key),
    FOREIGN KEY(project_id,submission_key) REFERENCES task_submissions(project_id,submission_key) ON DELETE CASCADE
  )`);
  const read = database.prepare(
    "SELECT record_json FROM task_submissions WHERE project_id=? AND submission_key=?",
  );
  const count = database.prepare("SELECT COUNT(*) AS count FROM task_submissions");
  const prune = database.prepare("DELETE FROM task_submissions WHERE completed=1 AND updated_at<?");
  const write = database.prepare(
    `INSERT INTO task_submissions(project_id,submission_key,record_json,completed,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,submission_key) DO UPDATE SET record_json=excluded.record_json,completed=excluded.completed,updated_at=excluded.updated_at`,
  );
  const readIntent = database.prepare(
    "SELECT engine,workspace_path FROM acp_submission_intents WHERE project_id=? AND submission_key=?",
  );
  const writeIntent = database.prepare(
    "INSERT INTO acp_submission_intents(project_id,submission_key,engine,workspace_path) VALUES(?,?,?,?) ON CONFLICT(project_id,submission_key) DO UPDATE SET engine=excluded.engine,workspace_path=excluded.workspace_path",
  );
  const save = ({ projectId, key, recordJson, completed }) => {
    const now = Date.now();
    prune.run(now - 7 * 24 * 60 * 60 * 1000);
    if (!read.get(projectId, key) && count.get().count >= 10000)
      throw new Error("Submission recovery capacity is exhausted");
    write.run(projectId, key, recordJson, completed ? 1 : 0, now);
    return null;
  };
  return {
    readSubmission({ projectId, key }) {
      return read.get(projectId, key)?.record_json;
    },
    writeSubmission: database.transaction(save),
    // 认领创建与发送都必须核对读取时的状态，旧快照不能覆盖恢复后的 starting。
    claimSubmission: database.transaction(({ projectId, key, expectedJson, recordJson }) => {
      const row = read.get(projectId, key);
      const current = row ? JSON.parse(row.record_json) : undefined;
      const expected = expectedJson ? JSON.parse(expectedJson) : undefined;
      const next = JSON.parse(recordJson);
      if (next.stage !== "creating" && next.stage !== "starting") return false;
      if (
        expected &&
        (expected.stage !== "ready" ||
          expected.result !== undefined ||
          expected.fingerprint !== next.fingerprint ||
          (next.stage === "creating" && expected.task))
      )
        return false;
      if (
        expected
          ? !current ||
            current.stage !== expected.stage ||
            current.fingerprint !== expected.fingerprint ||
            current.task?.id !== expected.task?.id ||
            current.result !== undefined
          : current !== undefined
      )
        return false;
      save({ projectId, key, recordJson, completed: false });
      return true;
    }).immediate,
    writeAcpSubmission: database.transaction((input) => {
      save(input);
      writeIntent.run(input.projectId, input.key, input.intent.engine, input.intent.workspacePath);
      return null;
    }).immediate,
    // 先取得写锁再检查源状态，避免多个 Worker 的读快照升级发生竞争。
    recoverAcpSubmission: database.transaction(
      ({ projectId, sourceKey, key, fingerprint, intent }) => {
        if (sourceKey === key || read.get(projectId, key)) return null;
        const metadata = readIntent.get(projectId, sourceKey);
        if (
          !metadata ||
          metadata.engine !== intent.engine ||
          metadata.workspace_path !== intent.workspacePath
        )
          return null;
        const row = read.get(projectId, sourceKey);
        if (!row) return null;
        const source = JSON.parse(row.record_json);
        if (source.stage !== "ready" || !source.task) return null;
        const recovered = { fingerprint, stage: "ready", task: source.task };
        // 同一事务写入新记录并使旧记录失效，崩溃不能留下两个可发送入口。
        save({ projectId, key, recordJson: JSON.stringify(recovered), completed: false });
        writeIntent.run(projectId, key, intent.engine, intent.workspacePath);
        save({
          projectId,
          key: sourceKey,
          recordJson: JSON.stringify({ ...source, stage: "starting" }),
          completed: false,
        });
        return JSON.stringify(recovered);
      },
    ).immediate,
  };
}
