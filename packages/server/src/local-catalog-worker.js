import { createHash } from "node:crypto";

function project(row) {
  return row ? { id: row.id, name: row.name, path: row.path, createdAt: row.created_at } : null;
}
function task(row) {
  return row
    ? {
        id: row.id,
        projectId: row.project_id,
        title: row.title,
        cwd: row.cwd,
        provider: row.provider,
        sessionId: row.session_id,
        updatedAt: row.updated_at,
        pinned: Boolean(row.pinned),
        archived: Boolean(row.archived),
        status: row.status,
      }
    : null;
}

function assertImmutableBinding(current, candidate) {
  if (!current) return;
  // Worker 是实际持久化边界，不能只依赖 TypeScript 排除字段来保护身份。
  for (const key of ["provider", "projectId", "sessionId"]) {
    if (key === "sessionId" && current.sessionId === null) continue;
    if (Object.hasOwn(candidate, key) && candidate[key] !== current[key])
      throw new Error(`Task ${key} is immutable`);
  }
}

export function createLocalCatalogOperations(db) {
  // 自定义迁移测试可能刻意只建部分表，此时不提前准备不存在的业务表。
  const readProject = (id) =>
    project(db.prepare("SELECT * FROM managed_projects WHERE id = ?").get(id));
  const readTask = (id) => task(db.prepare("SELECT * FROM managed_tasks WHERE id = ?").get(id));
  const listProjects = () =>
    db.prepare("SELECT * FROM managed_projects ORDER BY position, id").all().map(project);
  const putProject = db.transaction((p) => {
    db.prepare(
      `INSERT INTO managed_projects VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position)+1,0) FROM managed_projects))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path`,
    ).run(p.id, p.name, p.path, p.createdAt);
    // 旧设置、队列、附件仍以 projects 外键关联；同事务更新兼容视图，避免两份身份分叉。
    db.prepare(
      `INSERT INTO projects (id,name,created_at,sort_order,kind)
      VALUES (?,?,?,(SELECT COALESCE(MAX(sort_order)+1,0) FROM projects),'user')
      ON CONFLICT(id) DO UPDATE SET name=excluded.name`,
    ).run(p.id, p.name, p.createdAt);
    db.prepare("DELETE FROM project_roots WHERE project_id=?").run(p.id);
    db.prepare("INSERT INTO project_roots (project_id,position,root_id,path) VALUES (?,0,?,?)").run(
      p.id,
      createHash("sha256").update(p.path).digest("hex").slice(0, 32),
      p.path,
    );
    return readProject(p.id);
  });
  const putTask = (t) => {
    assertImmutableBinding(readTask(t.id), t);
    db.prepare(
      `INSERT INTO managed_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    ).run(
      t.id,
      t.projectId,
      t.title,
      t.cwd,
      t.provider,
      t.sessionId,
      t.updatedAt,
      Number(t.pinned),
      Number(t.archived),
      t.status,
    );
    return readTask(t.id);
  };
  const operations = {
    "project.list": listProjects,
    "project.read": ({ id }) => readProject(id),
    "project.put": putProject,
    "project.rename": db.transaction(({ id, name }) => {
      if (!name.trim()) throw new Error("Project name is required");
      if (!db.prepare("UPDATE managed_projects SET name=? WHERE id=?").run(name.trim(), id).changes)
        throw new Error("Project not found");
      db.prepare("UPDATE projects SET name=? WHERE id=?").run(name.trim(), id);
      return readProject(id);
    }),
    "project.remove": db.transaction(({ id }) => {
      const active = db
        .prepare("SELECT 1 FROM managed_tasks WHERE project_id=? AND status='active' LIMIT 1")
        .get(id);
      if (active) throw new Error("Cannot remove a project with a running task");
      const removed = Boolean(
        db.prepare("DELETE FROM managed_projects WHERE id=?").run(id).changes,
      );
      if (removed) {
        db.prepare("DELETE FROM task_settings WHERE project_id=?").run(id);
        db.prepare("DELETE FROM projects WHERE id=? AND kind='user'").run(id);
      }
      return removed;
    }),
    "project.reorder": db.transaction(({ ids }) => {
      const current = listProjects();
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== current.length ||
        current.some((p) => !ids.includes(p.id))
      )
        throw new Error("Invalid project order");
      const update = db.prepare("UPDATE managed_projects SET position=? WHERE id=?");
      ids.forEach((id, index) => update.run(index, id));
      return listProjects();
    }),
    "task.put": putTask,
    "task.read": ({ id }) => readTask(id),
    "task.bindings": () => db.prepare("SELECT * FROM managed_tasks").all().map(task),
    "task.patch": ({ id, ...patch }) => {
      const current = readTask(id);
      if (!current) throw new Error("Task not found");
      assertImmutableBinding(current, patch);
      if (patch.title !== undefined) {
        if (!patch.title.trim()) throw new Error("Task title is required");
        patch.title = patch.title.trim();
      }
      const next = {
        ...current,
        ...patch,
        ...(current.sessionId !== null ? { sessionId: current.sessionId } : {}),
      };
      db.prepare(
        `UPDATE managed_tasks SET title=?,cwd=?,session_id=?,updated_at=?,pinned=?,archived=?,status=? WHERE id=?`,
      ).run(
        next.title,
        next.cwd,
        next.sessionId,
        next.updatedAt,
        Number(next.pinned),
        Number(next.archived),
        next.status,
        id,
      );
      return next;
    },
    "task.remove": db.transaction(({ id }) => {
      const task = readTask(id);
      if (task?.status === "active") throw new Error("Cannot delete a running task");
      const removed = Boolean(db.prepare("DELETE FROM managed_tasks WHERE id=?").run(id).changes);
      if (removed)
        for (const table of ["task_settings", "task_queue", "async_questions"])
          db.prepare(`DELETE FROM ${table} WHERE task_id=? AND project_id=?`).run(
            id,
            task.projectId ?? "temporary",
          );
      return removed;
    }),
    "task.list": (input) => {
      const where = ["archived = ?"],
        values = [Number(input.archived === true)];
      if (Object.hasOwn(input, "projectId")) {
        where.push("project_id IS ?");
        values.push(input.projectId);
      }
      if (input.pinned === true) where.push("pinned = 1");
      if (input.completed === true)
        where.push("status IN ('idle', 'notLoaded') AND project_id IS NOT NULL");
      if (input.searchTerm) {
        where.push("instr(lower(title), lower(?)) > 0");
        values.push(input.searchTerm);
      }
      if (input.cursor) {
        const cursor = JSON.parse(input.cursor);
        if (
          !Array.isArray(cursor) ||
          cursor.length !== 2 ||
          !Number.isFinite(cursor[0]) ||
          typeof cursor[1] !== "string"
        )
          throw new Error("Invalid task cursor");
        where.push("(updated_at, id) < (?, ?)");
        values.push(...cursor);
      }
      const limit = Math.min(100, Math.max(1, input.limit ?? 50));
      const rows = db
        .prepare(
          `SELECT * FROM managed_tasks WHERE ${where.join(" AND ")} ORDER BY updated_at DESC,id DESC LIMIT ?`,
        )
        .all(...values, limit + 1);
      const data = rows.slice(0, limit).map(task),
        last = data.at(-1);
      return {
        data,
        nextCursor: rows.length > limit ? JSON.stringify([last.updatedAt, last.id]) : null,
      };
    },
    "migration.done": () =>
      Boolean(db.prepare("SELECT 1 FROM managed_catalog_migration WHERE id=1").get()),
    "migration.import": db.transaction(({ projects, tasks }) => {
      if (operations["migration.done"]()) return;
      // 目录、任务与完成标记原子提交；中途失败重启不会看到半份目录。
      for (const p of projects) {
        putProject(p);
        if (p.sourceId && p.sourceId !== p.id) {
          const columns = db
            .prepare("PRAGMA table_info(project_defaults)")
            .all()
            .map((column) => column.name)
            .filter((name) => name !== "project_id");
          db.prepare(
            `INSERT INTO project_defaults (project_id,${columns.join(",")}) SELECT ?,${columns.join(",")} FROM project_defaults WHERE project_id=? ON CONFLICT(project_id) DO NOTHING`,
          ).run(p.id, p.sourceId);
        }
      }
      for (const t of tasks) {
        putTask(t);
        // 多根拆分后，任务级偏好和待处理记录跟随任务迁到实际所属目录。
        if (t.projectId !== null)
          for (const table of ["task_settings", "task_queue", "async_questions"]) {
            db.prepare(`UPDATE ${table} SET project_id=? WHERE task_id=? AND project_id<>?`).run(
              t.projectId,
              t.id,
              t.projectId,
            );
          }
      }
      db.prepare("INSERT INTO managed_catalog_migration VALUES (1)").run();
    }),
  };
  return {
    localCatalog: ({ operation, payload }) => {
      if (!Object.hasOwn(operations, operation)) throw new Error("Unknown catalog operation");
      return operations[operation](payload);
    },
  };
}
