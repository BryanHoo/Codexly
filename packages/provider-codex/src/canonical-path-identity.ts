import { realpath } from "node:fs/promises";
import { normalizedPathIdentity } from "./runtime-owner-registry.js";

export async function canonicalPathIdentity(path: string): Promise<string> {
  try {
    // 历史 Thread 可能保留符号链接路径，归属校验需要与已注册 Project 的真实路径对齐。
    return normalizedPathIdentity(await realpath(path));
  } catch {
    return normalizedPathIdentity(path);
  }
}

export async function isSameCanonicalPath(left: string, right: string): Promise<boolean> {
  const [leftIdentity, rightIdentity] = await Promise.all([
    canonicalPathIdentity(left),
    canonicalPathIdentity(right),
  ]);
  return leftIdentity === rightIdentity;
}
