import type { SharedSavedPrompt } from "@codexly/protocol";
import { configureSavedPrompts } from "@codexly/ui/core/saved-prompts-store";
import { invoke } from "./native-invoke.js";

/** 主窗口按需装配原生传输，独立任务窗口不加载提示词同步和索引。 */
export function initializeSavedPrompts(): void {
  configureSavedPrompts(async (input) => {
    try {
      return await invoke<SharedSavedPrompt[]>("sync_saved_prompts", { input });
    } catch (error) {
      // 原生命令的字符串错误转换为标准 Error，让两端共用的表单正确识别重复标题。
      throw typeof error === "string" ? new Error(error) : error;
    }
  });
}
