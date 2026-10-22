const wait = new Int32Array(new SharedArrayBuffer(4));

/** Called only during SQLite worker startup, outside a transaction. */
export function enableWal(database) {
  const deadline = performance.now() + 5_000;
  database.pragma("busy_timeout = 0");
  try {
    for (;;) {
      try {
        database.pragma("journal_mode = WAL");
        return;
      } catch (error) {
        const remaining = deadline - performance.now();
        if (
          remaining <= 0 ||
          typeof error.code !== "string" ||
          !(error.code === "SQLITE_BUSY" || error.code.startsWith("SQLITE_BUSY_"))
        )
          throw error;
        // Journal lock upgrades can bypass SQLite's busy handler.
        Atomics.wait(wait, 0, 0, Math.min(10, remaining));
      }
    }
  } finally {
    database.pragma("busy_timeout = 5000");
  }
}
