import { randomUUID, createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import type {
  LocalCatalogStore,
  LocalProject,
  ProjectProjectionStore,
  ProjectRepository,
  RegisterProjectInput,
} from "@codexly/core";
import type { Project } from "@codexly/protocol";

export function catalogProject(project: LocalProject): Project {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    roots: [
      {
        id: createHash("sha256").update(project.path).digest("hex").slice(0, 32),
        path: project.path,
      },
    ],
  };
}

/** 目录生命周期只依赖本地仓储；旧设置表仍通过原项目 ID 关联。 */
export class LocalProjectRepository implements ProjectRepository {
  constructor(
    private readonly store: LocalCatalogStore,
    _projection: ProjectProjectionStore,
  ) {}
  async list() {
    return (await this.store.catalog("project.list", undefined)).map(catalogProject);
  }
  async read(id: string) {
    const p = await this.store.catalog("project.read", { id });
    return p ? catalogProject(p) : undefined;
  }
  async register(input: RegisterProjectInput) {
    if (input.roots.length !== 1 || input.roots[0] === undefined)
      throw new Error("A project must contain exactly one folder");
    const path = await realpath(input.roots[0].path);
    if (!(await stat(path)).isDirectory()) throw new Error("Project path must be a directory");
    const existing = (await this.store.catalog("project.list", undefined)).find(
      (p) => p.path === path,
    );
    if (existing) return catalogProject(existing);
    const project = catalogProject(
      await this.store.catalog("project.put", {
        id: `project-${randomUUID()}`,
        path,
        name: input.name,
        createdAt: new Date().toISOString(),
      }),
    );
    return project;
  }
  async rename(id: string, name: string) {
    if (!(await this.read(id))) return undefined;
    const project = catalogProject(await this.store.catalog("project.rename", { id, name }));
    return project;
  }
  async remove(id: string) {
    const removed = await this.store.catalog("project.remove", { id });
    return removed;
  }
  async reorder(ids: readonly string[]) {
    return (await this.store.catalog("project.reorder", { ids })).map(catalogProject);
  }
  async synchronize() {
    const projects = await this.list();
    return projects;
  }
  async migrateLegacyProjects(_options: { recoverUnassigned: boolean }) {
    await this.synchronize();
  }
}
