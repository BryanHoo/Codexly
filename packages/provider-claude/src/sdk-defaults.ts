import {
  query,
  getSessionMessages,
  getSessionInfo,
  deleteSession,
  forkSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSdk } from "./session.js";

/** 官方 SDK 依赖集中注入，测试与宿主仍可覆盖执行文件和本地模拟 API。 */
export const DEFAULT_CLAUDE_SDK: ClaudeSdk = {
  query,
  getSessionMessages,
  getSessionInfo,
  deleteSession,
  forkSession,
};
