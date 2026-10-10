export type TextEditorNavigation = Readonly<{
  block: (options: {
    blockerFn: () => boolean | Promise<boolean>;
    enableBeforeUnload: boolean;
  }) => () => void;
}>;
export function blockTextEditorNavigation(
  history: TextEditorNavigation,
  hasUnsavedChanges: () => boolean,
  saveBeforeLeave?: () => Promise<boolean>,
): () => void {
  // 导航等待失焦保存完成；失败时保持当前文档，成功后继续原来的导航。
  return history.block({
    blockerFn: () => {
      if (!hasUnsavedChanges()) return false;
      return saveBeforeLeave ? saveBeforeLeave().then((saved) => !saved) : true;
    },
    enableBeforeUnload: false,
  });
}
