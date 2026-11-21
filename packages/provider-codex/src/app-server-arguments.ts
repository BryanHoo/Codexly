// 正式服务与配置诊断共用功能参数，避免诊断读取到与实际启动不同的有效配置。
// 仅关闭发现预取；已安装插件仍由 Codex 同步，目录在插件页打开时按需查询。
export const CODEX_APP_SERVER_ARGUMENTS = [
  "app-server",
  "--enable",
  "plugins",
  "-c",
  "features.plugin_discovery_prefetch=false",
  // 上游默认关闭参数增量，开启后可在补丁应用前显示文件差异。
  "-c",
  "features.apply_patch_streaming_events=true",
] as const;
