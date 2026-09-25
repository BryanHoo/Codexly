import { i18n } from "./i18n.js";

// 接入页文案按需注册，避免增加工作台首屏的语言资源体积。
i18n.addResourceBundle("zh-CN", "settings", { provider: {
  connection: "服务连接",
  credentials: "连接配置",
  account: "ChatGPT 账号",
  showKey: "显示密钥",
  hideKey: "隐藏密钥",
  automaticModels: "自动获取模型",
  modelCount: "{{count}} 个模型",
  connecting: "正在连接",
} }, true);
i18n.addResourceBundle("en", "settings", { provider: {
  connection: "Service connection",
  credentials: "Connection settings",
  account: "ChatGPT account",
  showKey: "Show API key",
  hideKey: "Hide API key",
  automaticModels: "Automatic model discovery",
  modelCount_one: "{{count}} model",
  modelCount_other: "{{count}} models",
  connecting: "Connecting",
} }, true);
