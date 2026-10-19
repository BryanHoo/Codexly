import { useEffect, useState } from "react";

/** 两端共用静默恢复窗口，短暂网络抖动不会打断阅读或改变时间线布局。 */
export function ReconnectingNotice({
  message,
  reconnecting,
}: Readonly<{ message: string; reconnecting: boolean }>) {
  // 恢复成功即卸载计时组件；下一次断连重新计时，不累积之前的失败时间。
  return reconnecting ? <DelayedReconnectingNotice message={message} /> : null;
}

function DelayedReconnectingNotice({ message }: Readonly<{ message: string }>) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // 仅连续恢复超过 10 秒才提示；只登记一次性定时器，卸载立即释放。
    const timer = setTimeout(() => {
      setVisible(true);
    }, 10_000);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return visible ? (
    <div
      className="bg-control px-3 py-1.5 text-center text-label text-muted-foreground"
      role="status"
    >
      {message}
    </div>
  ) : null;
}
