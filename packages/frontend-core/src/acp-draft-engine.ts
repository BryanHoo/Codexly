import type { AgentEngine } from "@codexly/protocol";
type StoragePort = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}>;
const prefix = "codexly:acp-engine-draft:v1:";
/** 旧选择只读导入；私有偏好继续使用原始引擎身份，不存储厂商模型或权限枚举。 */
export function readAcpDraftEngine(
  storage: StoragePort,
  scope: string,
  engines: readonly AgentEngine[],
): AgentEngine {
  const fallback = engines[0] ?? "codex";
  if (engines.length < 2) return fallback;
  try {
    const saved =
      storage.getItem(`${prefix}${scope}`) ?? storage.getItem(`codexly:engine-draft:v1:${scope}`);
    return (saved === "codex" || saved === "claude") && engines.includes(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}
export function saveAcpDraftEngine(storage: StoragePort, scope: string, engine: AgentEngine): void {
  try {
    storage.setItem(`${prefix}${scope}`, engine);
  } catch {
    /* 可选选择记忆失败不影响当前草稿；真正提交身份由独立恢复记录保护。 */
  }
}
