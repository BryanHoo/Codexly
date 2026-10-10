const LOCAL_REFERENCE_PREFIXES = [
  "/__codexly_relative__/",
  "/__codeagent_relative__/",
  "/__codexly_unc__/",
  "/__codeagent_unc__/",
];

export function getMarkdownImagePath(source: string): string | null {
  // 网络和浏览器资源保持原 URL；本地路径交给宿主校验，不能按网页目录解析。
  if (/^(?:https?:|data:|blob:|asset:|\/\/)/iu.test(source)) return null;
  let path = source;
  try {
    path = decodeURIComponent(path);
  } catch {
    // 损坏的百分号编码保留原文，由受控文件读取决定是否可用。
  }
  for (const prefix of LOCAL_REFERENCE_PREFIXES) {
    if (path.startsWith(prefix)) {
      const relative = path.slice(prefix.length);
      return prefix.includes("_unc__") ? `//${relative}` : relative;
    }
  }
  if (/^file:\/\//iu.test(path)) path = path.replace(/^file:\/\//iu, "");
  if (/^sandbox:/iu.test(path)) path = path.slice("sandbox:".length);
  // Markdown 为避免盘符被当作 URL 协议会增加斜杠，交给 Windows 前恢复盘符。
  if (/^\/[a-z]:[\\/]/iu.test(path)) path = path.slice(1);
  return path;
}
