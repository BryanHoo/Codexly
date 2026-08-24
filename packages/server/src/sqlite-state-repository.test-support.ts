import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { Project } from "@code-agent/protocol";
import { SqliteStateRepository, type SqliteMigration } from "./sqlite-state-repository.js";

// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export type RepositoryTestOptions = Readonly<{
  migrations?: readonly SqliteMigration[];
  requestTimeoutMs?: number;
  workerUrl?: URL;
}>;

export const repositories: SqliteStateRepository[] = [];

export function createProject(id: string, name: string, rootPath: string): Project {
  return {
    createdAt: "2026-08-21T00:00:00.000Z",
    id,
    name,
    roots: [{ id: `${id}-root`, path: rootPath }],
  };
}

export async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "code-agent-sqlite-"));
}

export async function openRepository(
  root: string,
  options: RepositoryTestOptions = {},
): Promise<SqliteStateRepository> {
  const repository = await SqliteStateRepository.open(join(root, "state.sqlite3"), options);
  repositories.push(repository);
  return repository;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.close()));
});
