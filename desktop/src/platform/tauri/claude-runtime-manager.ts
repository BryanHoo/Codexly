import { Channel } from "@tauri-apps/api/core";
import type { CodexRuntimeInstallProgress } from "@/protocol/index.js";
import { invoke } from "./native-invoke.js";

/** 与 Codex 共用进度契约；原生端串行合并安装并按应用清单校验缓存。 */
export async function prepareClaudeRuntime(
  onProgress: (progress: CodexRuntimeInstallProgress) => void = () => undefined,
): Promise<void> {
  let sequence = 0;
  const channel = new Channel<CodexRuntimeInstallProgress>((progress) => {
    if (progress.sequence <= sequence) return;
    sequence = progress.sequence;
    onProgress(progress);
  });
  await invoke("prepare_claude_runtime", { onProgress: channel });
}
