/** 将既有可取消焦点回调映射到 Base UI 的 initialFocus / finalFocus。
 * 返回 false 表示调用方已手动恢复分屏或编辑器焦点；未取消则使用原生焦点管理。
 */
export function dialogFocus(handler: ((event: Event) => void) | undefined) {
  if (!handler) return undefined;
  return () => {
    const event = new Event("dialog-auto-focus", { cancelable: true });
    handler(event);
    return !event.defaultPrevented;
  };
}
