import { cp, stat } from "node:fs/promises";

/** 缺省资源可以不存在；已存在资源复制失败必须上抛，不能发布缺失历史的分支。 */
export async function copyClaudeStorage(
  source: string,
  target: string,
  required = false,
): Promise<void> {
  try {
    await stat(source);
  } catch (error) {
    if (!required && error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  // 独立文件保证原会话删除或更新时不会改变分支；大文件由文件系统复制，不读入 JS 内存。
  // 多条消息可以引用同一个内容哈希，已复制的同源正文允许复用。
  await cp(source, target, { recursive: true, force: false });
}
