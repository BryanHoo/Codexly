import type { ReactNode } from "react";

export function SettingsUpdateActions({
  checkAction,
  children,
}: Readonly<{
  checkAction: ReactNode;
  children: ReactNode;
}>) {
  return (
    <div className="flex w-full min-w-0 max-w-full items-center justify-end gap-2 py-2">
      {/* 操作区按内容宽度靠右；窄屏只滚动版本状态和安装操作，不挤出检查入口。 */}
      <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap">
        {children}
      </div>
      {/* 检查入口独立固定在最右侧，发现新版本后连续点击原坐标仍只会检查更新。 */}
      <div className="shrink-0">{checkAction}</div>
    </div>
  );
}
