const dialogSelector = '[role="dialog"]:not([data-toast]), [role="alertdialog"], dialog[open]';

export function hasKeyboardBlockingDialog(includeMenus = false): boolean {
  const selector = includeMenus ? `${dialogSelector}, [role="menu"]` : dialogSelector;
  // 通知沿用 Base UI 的 dialog 语义，但不占用模态键盘边界。
  return Array.from(document.querySelectorAll(selector)).some(
    (element) => element.getClientRects().length > 0,
  );
}
