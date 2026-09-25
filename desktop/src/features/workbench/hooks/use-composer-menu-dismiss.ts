import { useEffect } from "react";

type ComposerMenuDismissOptions = Readonly<{
  closeCommandMenu: () => void;
  closeFileMenu: () => void;
  commandMenuOpen: boolean;
  commandSurfaceRef: Readonly<{ current: HTMLElement | null }>;
  fileMenuOpen: boolean;
  turnControlsDisabled: boolean;
}>;

export function useComposerMenuDismiss({
  closeCommandMenu,
  closeFileMenu,
  commandMenuOpen,
  commandSurfaceRef,
  fileMenuOpen,
  turnControlsDisabled,
}: ComposerMenuDismissOptions): void {
  useEffect(() => {
    if (turnControlsDisabled) {
      closeCommandMenu();
      closeFileMenu();
    }
  }, [closeCommandMenu, closeFileMenu, turnControlsDisabled]);

  useEffect(() => {
    if (!commandMenuOpen && !fileMenuOpen) return undefined;
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeCommandMenu();
      closeFileMenu();
    };
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const eventTarget = event.target;
      if (eventTarget instanceof Node && !commandSurfaceRef.current?.contains(eventTarget)) {
        // 输入框和命令弹层共享一个交互区域，只有点击区域外部才关闭弹层。
        closeCommandMenu();
        closeFileMenu();
      }
    };
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [closeCommandMenu, closeFileMenu, commandMenuOpen, commandSurfaceRef, fileMenuOpen]);
}
