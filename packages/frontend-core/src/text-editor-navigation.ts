export type TextEditorNavigation = Readonly<{
  block: (options: {
    blockerFn: (transition: { nextLocation: { pathname: string } }) => boolean | Promise<boolean>;
    enableBeforeUnload: boolean;
  }) => () => void;
}>;

/** 只识别工作台任务/草稿路由，设置页等其他路由仍按离开工作区处理。 */
export function isProjectTaskLocation(pathname: string, projectId: string): boolean {
  const match = /^\/p\/([^/]+)(?:\/t\/[^/]+)?\/?$/u.exec(pathname);
  if (!match?.[1]) return false;
  try {
    return decodeURIComponent(match[1]) === projectId;
  } catch {
    return false;
  }
}
export function blockTextEditorNavigation(
  history: TextEditorNavigation,
  hasUnsavedChanges: () => boolean,
  confirmBeforeLeave?: () => Promise<boolean>,
): () => void {
  // 页面导航由调用方显式询问保存/不保存/取消；不在导航保护层隐式写盘。
  return history.block({
    blockerFn: () => {
      if (!hasUnsavedChanges()) return false;
      return confirmBeforeLeave ? confirmBeforeLeave().then((saved) => !saved) : true;
    },
    enableBeforeUnload: false,
  });
}
