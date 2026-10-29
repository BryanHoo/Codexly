import { createConversationDisplayPreferenceStore } from "@codexly/frontend-core/conversation-display-preferences";
import { appPreferenceStorage } from "../../platform/tauri/app-storage.js";

// 惰性读取发生在原生偏好初始化后的首次渲染，持久化继续复用 Tauri 存储链路。
export const conversationDisplayPreferences = createConversationDisplayPreferenceStore(
  appPreferenceStorage,
  "codeagent:conversation-display:v1",
);
