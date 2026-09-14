import { link, lstat, mkdir, rename, rmdir, unlink } from "node:fs/promises";

export async function renameWithoutOverwrite(source: string, target: string, directory: boolean) {
  if (!directory) {
    // 硬链接原子占用目标名称；EEXIST 时绝不覆盖内容，成功后才删除旧名称。
    await link(source, target);
    try {
      await unlink(source);
    } catch (error) {
      // 保留原文件；只清理仍指向原 inode 的本次链接。
      const [original, created] = await Promise.all([lstat(source), lstat(target)]);
      if (original.ino === created.ino && original.dev === created.dev) await unlink(target);
      throw error;
    }
    return;
  }
  if (process.platform === "win32") {
    // Windows 的目录 rename 原生拒绝替换已有目录。
    const existing = await lstat(target).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (existing !== undefined)
      throw Object.assign(new Error("Destination already exists"), { code: "EEXIST" });
    await rename(source, target);
    return;
  }
  // POSIX rename 会覆盖空目录；先独占创建占位目录，拒绝任何已有目标。
  await mkdir(target);
  const reservation = await lstat(target);
  try {
    await rename(source, target);
  } catch (error) {
    const current = await lstat(target);
    if (current.ino === reservation.ino && current.dev === reservation.dev) {
      // 仅删除仍为空的占位目录，不递归删除外部进程可能写入的内容。
      await rmdir(target).catch(() => undefined);
    }
    throw error;
  }
}
