export const sidebarFooterChinese = {
  connectionStatus: "终端连接状态：{{status}}",
  settings: "设置",
  help: "帮助",
  version: "关于，Codexly v{{version}}",
  update: "升级",
  guide: "使用文档",
  shortcuts: "键盘快捷键",
} as const;

export const sidebarFooterEnglish: Record<keyof typeof sidebarFooterChinese, string> = {
  connectionStatus: "Terminal connection status: {{status}}",
  settings: "Settings",
  help: "Help",
  version: "About Codexly v{{version}}",
  update: "Upgrade",
  guide: "User guide",
  shortcuts: "Keyboard shortcuts",
};

export function translateSidebarFooterLabels(
  translate: (key: keyof typeof sidebarFooterChinese) => string,
) {
  return Object.fromEntries(
    Object.keys(sidebarFooterChinese).map((key) => [
      key,
      translate(key as keyof typeof sidebarFooterChinese),
    ]),
  ) as Record<keyof typeof sidebarFooterChinese, string>;
}
