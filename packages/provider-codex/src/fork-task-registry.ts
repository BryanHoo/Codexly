import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

function key(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 仅记录原生列表尚未收录的持久分支 ID；任务元数据始终从 Codex 读取。 */
export class ForkTaskRegistry {
  public constructor(private readonly directory: string) {}

  public async record(projectId: string, taskId: string): Promise<void> {
    const directory = join(this.directory, key(projectId));
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `${key(taskId)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, taskId, { flag: "wx" });
      await rename(temporary, join(directory, key(taskId)));
    } finally {
      await rm(temporary, { force: true });
    }
  }

  public async list(projectId: string): Promise<string[]> {
    const directory = join(this.directory, key(projectId));
    let filenames: string[];
    try {
      filenames = await readdir(directory);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const taskIds: string[] = [];
    for (const filename of filenames) {
      if (!/^[a-f0-9]{64}$/u.test(filename)) continue;
      const taskId = await readFile(join(directory, filename), "utf8").catch((error: unknown) => {
        if (isMissing(error)) return undefined;
        throw error;
      });
      if (taskId !== undefined && taskId.length <= 256 && key(taskId) === filename) {
        taskIds.push(taskId);
      }
    }
    return taskIds;
  }

  public async forget(projectId: string, taskId: string): Promise<void> {
    await rm(join(this.directory, key(projectId), key(taskId)), { force: true });
  }
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
