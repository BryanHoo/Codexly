export const sidebarFooterChinese = {
  connectionStatus: "终端连接状态：{{status}}",
  settings: "设置",
  help: "帮助",
  version: "关于，Codexly v{{version}}",
  update: "升级",
  guide: "使用文档",
  shortcuts: "键盘快捷键",
  notifications: "通知",
  unread: "未读",
  read: "已读",
  markAllRead: "全部已读",
  markRead: "标为已读",
  clearRead: "清空已读",
  empty: "暂无通知",
  emptyUnread: "暂无未读通知",
  emptyRead: "暂无已读通知",
  close: "关闭通知",
  loadMore: "显示更多",
  completed: "任务已完成",
  failed: "任务失败",
  approval: "等待审批",
  input: "等待输入",
} as const;

export const sidebarFooterEnglish: Record<keyof typeof sidebarFooterChinese, string> = {
  connectionStatus: "Terminal connection status: {{status}}",
  settings: "Settings",
  help: "Help",
  version: "About Codexly v{{version}}",
  update: "Upgrade",
  guide: "User guide",
  shortcuts: "Keyboard shortcuts",
  notifications: "Notifications",
  unread: "Unread",
  read: "Read",
  markAllRead: "Mark all as read",
  markRead: "Mark as read",
  clearRead: "Clear read",
  empty: "No notifications yet",
  emptyUnread: "No unread notifications",
  emptyRead: "No read notifications",
  close: "Close notifications",
  loadMore: "Show more",
  completed: "Task completed",
  failed: "Task failed",
  approval: "Approval needed",
  input: "Input needed",
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
