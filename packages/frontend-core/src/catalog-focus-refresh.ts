/** 仅匹配目录列表；正文快照、工具页和队列仍使用各自的事件与订阅生命周期。 */
export function isCatalogListQuery(key: readonly unknown[]): boolean {
  if (key[0] === "task-board") return key[1] === "completed";
  if (key[0] !== "projects") return false;
  if (key.length === 1 || key[2] === "archived-tasks") return true;
  return (
    key[2] === "tasks" && (key.length === 3 || key[3] === "pinned" || key[3] === "search-source")
  );
}

/** Web 与桌面共用事件驱动刷新：恢复窗口时补读外部提交，不引入后台定时轮询。 */
export function installCatalogFocusRefresh(
  refresh: () => void,
  windowTarget: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  documentTarget: Pick<EventTarget, "addEventListener" | "removeEventListener"> & {
    readonly visibilityState: string;
  },
): () => void {
  let disposed = false;
  let pending = false;
  const schedule = () => {
    if (disposed || pending || documentTarget.visibilityState !== "visible") return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (!disposed && documentTarget.visibilityState === "visible") refresh();
    });
  };
  windowTarget.addEventListener("focus", schedule);
  documentTarget.addEventListener("visibilitychange", schedule);
  return () => {
    disposed = true;
    windowTarget.removeEventListener("focus", schedule);
    documentTarget.removeEventListener("visibilitychange", schedule);
  };
}
