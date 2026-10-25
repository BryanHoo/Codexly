import { invoke } from "./native-invoke.js";

/** 目标路径由原生保存窗口选择，前端仅提供建议文件名与 JSON 正文；取消返回 null。 */
export function saveConversationExport(file: { fileName: string; content: string }): Promise<string | null> {
  return invoke("save_conversation_export", file);
}
