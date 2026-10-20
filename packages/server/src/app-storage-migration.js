import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import schema from "../../protocol/src/local-catalog-schema.json" with { type: "json" };
import migration from "../../protocol/src/app-storage-migration.json" with { type: "json" };

function publish(temporary, target) {
  try {
    // 硬链接在三平台都提供原子的“不覆盖发布”；并发启动不能替换已经打开的数据库。
    linkSync(temporary, target);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
}

function copyFiles(source, target) {
  mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(source)) {
    // 数据库由 SQLite 读取（包含 WAL）；锁、临时文件和符号链接不作为业务数据导入。
    if (name.includes(".sqlite3") || /\.(?:lock|tmp)$/.test(name) || name === ".DS_Store") continue;
    const from = join(source, name),
      to = join(target, name);
    const metadata = lstatSync(from);
    if (metadata.isSymbolicLink()) continue;
    if (metadata.isDirectory()) copyFiles(from, to);
    else if (metadata.isFile() && !existsSync(to)) {
      const temporary = join(target, `.migration-${randomUUID()}.tmp`);
      try {
        copyFileSync(from, temporary, constants.COPYFILE_EXCL);
        publish(temporary, to);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
  }
}

function writeJson(path, value, replace = false) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.migration-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    if (replace) renameSync(temporary, path);
    else publish(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function remapProjectFiles(source, root, mappings) {
  // 同一文件夹在旧两端可能拥有不同项目 ID；附件及偏好必须跟随合并后的 ID。
  const preferencesPath = join(root, "agent-settings.json");
  const originalPreferences = join(source, "agent-settings.json");
  const preferences = existsSync(preferencesPath)
    ? JSON.parse(readFileSync(preferencesPath, "utf8"))
    : undefined;
  const original = existsSync(originalPreferences)
    ? JSON.parse(readFileSync(originalPreferences, "utf8"))
    : undefined;
  let changed = false;
  for (const { old_id: oldId, new_id: newId } of mappings) {
    if (![oldId, newId].every((id) => /^[a-zA-Z0-9_-]{1,256}$/.test(id)))
      throw new Error("Invalid legacy project identifier");
    const attachments = join(source, "attachments", oldId);
    if (existsSync(attachments)) copyFiles(attachments, join(root, "attachments", newId));
    const settings = join(source, "task-settings", oldId);
    if (existsSync(settings))
      for (const filename of readdirSync(settings)) {
        const target = join(root, "task-settings", newId, filename);
        if (
          !filename.endsWith(".json") ||
          existsSync(target) ||
          !lstatSync(join(settings, filename)).isFile()
        )
          continue;
        const value = JSON.parse(readFileSync(join(settings, filename), "utf8"));
        if (value.projectId !== oldId) throw new Error("Invalid legacy task settings project");
        writeJson(target, { ...value, projectId: newId });
      }
    if (
      preferences?.projects &&
      original?.projects?.[oldId] &&
      !Object.hasOwn(preferences.projects, newId)
    ) {
      preferences.projects[newId] = original.projects[oldId];
      changed = true;
    }
  }
  if (changed) writeJson(preferencesPath, preferences, true);
}

/** 只在 SQLite Worker 启动时迁移；旧目录保留作备份，完成标记防止删除的历史再次复活。 */
export function prepareAppStorage(databasePath, legacyDirectories = []) {
  const root = dirname(databasePath);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (legacyDirectories.length === 0) return;
  const sources = [...new Set(legacyDirectories.map((path) => resolve(path)))].filter(
    (path) => path !== resolve(root) && existsSync(path),
  );
  if (!existsSync(databasePath)) {
    const original = sources.map((source) => join(source, "state.sqlite3")).find(existsSync);
    if (original) {
      const temporary = join(root, `.migration-${randomUUID()}.tmp`);
      const source = new Database(original, { readonly: true });
      try {
        // VACUUM INTO 从一致的 SQLite 快照复制，绝不逐个复制 db/wal/shm。
        source.prepare("VACUUM INTO ?").run(temporary);
        publish(temporary, databasePath);
      } finally {
        source.close();
        rmSync(temporary, { force: true });
      }
    }
  }
  const db = new Database(databasePath);
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.transaction(() => {
      db.exec(schema.sql);
      db.exec(migration.normalizeProjectsSql);
      db.exec("CREATE TABLE IF NOT EXISTS app_storage_migrations (source TEXT PRIMARY KEY) STRICT");
    }).immediate();
    for (const source of sources) {
      const done = () =>
        Boolean(db.prepare("SELECT 1 FROM app_storage_migrations WHERE source=?").get(source));
      if (done()) continue;
      copyFiles(source, root);
      const original = ["state.sqlite3", "catalog.sqlite3"]
        .map((filename) => join(source, filename))
        .find(existsSync);
      if (original) db.prepare("ATTACH DATABASE ? AS legacy").run(original);
      try {
        db.transaction(() => {
          if (done()) return;
          if (
            original &&
            db.prepare("SELECT 1 FROM legacy.sqlite_master WHERE name='managed_projects'").get()
          ) {
            remapProjectFiles(source, root, db.prepare(migration.projectMappingSql).all());
            db.exec(migration.importSql);
          }
          // 完成标记与目录数据处于同一事务，中断和双端竞争都不会重复导入。
          db.prepare("INSERT INTO app_storage_migrations VALUES (?)").run(source);
        }).immediate();
      } finally {
        if (original) db.exec("DETACH DATABASE legacy");
      }
    }
  } finally {
    db.close();
  }
}
