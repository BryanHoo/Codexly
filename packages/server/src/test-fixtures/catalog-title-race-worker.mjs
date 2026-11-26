import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import { createLocalCatalogOperations } from "../local-catalog-worker.js";
const db = new Database(workerData.path, { timeout: 5000 });
let tracking = false,
  reported = false;
const checkpoint = () => {
  if (tracking && !reported) {
    reported = true;
    parentPort.postMessage({ checkpoint: true });
  }
};
const prepare = db.prepare.bind(db),
  transaction = db.transaction.bind(db);
// 只控制竞争调度：旧补丁读完再放行；持锁补丁在尝试事务时放行，不断言实现细节。
db.prepare = (sql) => {
  const statement = prepare(sql);
  if (sql.includes("managed_tasks") && sql.includes("WHERE id = ?")) {
    const get = statement.get.bind(statement);
    statement.get = (...args) => {
      const row = get(...args);
      checkpoint();
      return row;
    };
  }
  return statement;
};
db.transaction = (callback) => {
  const wrapped = transaction(callback);
  return Object.assign((...args) => wrapped(...args), {
    immediate: (...args) => {
      checkpoint();
      return wrapped.immediate(...args);
    },
    deferred: (...args) => wrapped.deferred(...args),
    exclusive: (...args) => wrapped.exclusive(...args),
  });
};
const operations = createLocalCatalogOperations(db);
parentPort.on("message", () => {
  tracking = true;
  try {
    parentPort.postMessage({
      result: operations.localCatalog({
        operation: "task.patch",
        payload: { id: "race", status: "idle" },
      }),
    });
  } catch (error) {
    parentPort.postMessage({ error: String(error) });
  }
});
parentPort.postMessage({ ready: true });
