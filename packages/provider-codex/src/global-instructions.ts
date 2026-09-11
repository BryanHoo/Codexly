import { mkdir, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { GlobalInstructions, SaveGlobalInstructions } from "@codexly/protocol";

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export function createGlobalInstructionsStore(home: string) {
  let pending = Promise.resolve();
  const read = async (): Promise<GlobalInstructions> => ({
    content: await readOptional(join(home, "AGENTS.md")),
    path: join(home, "AGENTS.md"),
    overrideActive: (await readOptional(join(home, "AGENTS.override.md"))).trim().length > 0,
  });
  return {
    read,
    save(input: SaveGlobalInstructions): Promise<GlobalInstructions> {
      const result = pending.then(async () => {
        const path = join(home, "AGENTS.md");
        // 串行比较原文，拒绝覆盖其他编辑器或浏览器已保存的修改。
        if ((await readOptional(path)) !== input.expectedContent) {
          throw Object.assign(new Error("Global instructions changed; reload before saving"), {
            code: "GLOBAL_INSTRUCTIONS_CHANGED",
          });
        }
        await mkdir(home, { recursive: true });
        let target = path;
        try {
          target = await realpath(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        // 写入真实目标旁的临时文件，保留用户的符号链接与原文件权限。
        const temporary = join(dirname(target), `.AGENTS-${randomUUID()}.tmp`);
        const file = await open(temporary, "wx", 0o600);
        try {
          try {
            await file.chmod((await stat(target)).mode);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          await file.writeFile(input.content, "utf8");
          await file.sync();
          await file.close();
          if ((await readOptional(path)) !== input.expectedContent)
            throw Object.assign(new Error("Global instructions changed; reload before saving"), {
              code: "GLOBAL_INSTRUCTIONS_CHANGED",
            });
          await rename(temporary, target);
        } finally {
          await file.close();
          await unlink(temporary).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          });
        }
        return read();
      });
      pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
