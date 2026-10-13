import Database from "better-sqlite3";

export function createScheduledTaskCoordination(databasePath) {
  // 独立连接只承载短期调度互斥，避免异步业务操作占住主状态库的写事务。
  const database = new Database(`${databasePath}.scheduled-lock`, { timeout: 5_000 });
  database.exec(`CREATE TABLE IF NOT EXISTS run_owners (
    run_id TEXT PRIMARY KEY, pid INTEGER NOT NULL
  ) STRICT`);
  const list = database.prepare("SELECT run_id, pid FROM run_owners");
  const remove = database.prepare("DELETE FROM run_owners WHERE run_id = ?");
  const claim = database.prepare("INSERT INTO run_owners (run_id, pid) VALUES (?, ?)");
  return {
    initialize(operation) {
      // 新数据目录的建表和迁移同样串行化，避免多个实例首次启动时争抢 Schema。
      try {
        return database.transaction(operation).immediate();
      } finally {
        database.pragma("busy_timeout = 0");
      }
    },
    close: () => database.close(),
    operations: {
      acquireScheduledTaskLock() {
        if (database.inTransaction) return false;
        try {
          database.exec("BEGIN IMMEDIATE");
          return true;
        } catch (error) {
          if (error.code === "SQLITE_BUSY") return false;
          throw error;
        }
      },
      releaseScheduledTaskLock() {
        database.exec("COMMIT");
        return null;
      },
      listActiveScheduledTaskRunIds() {
        const active = [];
        for (const row of list.all()) {
          try {
            // 进程存活时保留领取结果，另一个实例启动不能把正在运行的计划当成崩溃恢复。
            process.kill(row.pid, 0);
            active.push(row.run_id);
          } catch (error) {
            if (error.code === "ESRCH") remove.run(row.run_id);
            else active.push(row.run_id);
          }
        }
        return active;
      },
      claimScheduledTaskRun(payload) {
        claim.run(payload.runId, process.pid);
        return null;
      },
      releaseScheduledTaskRun(payload) {
        remove.run(payload.runId);
        return null;
      },
    },
  };
}
