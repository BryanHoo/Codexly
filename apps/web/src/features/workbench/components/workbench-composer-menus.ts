import { useEffect, type RefObject } from "react";

export function useComposerMenuDismissal({
  closeCommandMenu,
  closeFileMenu,
  commandMenuOpen,
  commandSurfaceRef,
  fileMenuOpen,
  turnControlsDisabled,
}: Readonly<{
  closeCommandMenu: () => void;
  closeFileMenu: () => void;
  commandMenuOpen: boolean;
  commandSurfaceRef: RefObject<HTMLDivElement | null>;
  fileMenuOpen: boolean;
  turnControlsDisabled: boolean;
}>) {
  useEffect(() => {
    if (turnControlsDisabled) {
      closeCommandMenu();
      closeFileMenu();
    }
  }, [closeCommandMenu, closeFileMenu, turnControlsDisabled]);
  useEffect(() => {
    if (!commandMenuOpen && !fileMenuOpen) return undefined;
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandMenu();
        closeFileMenu();
      }
    };
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target;
      // 输入框与弹层共用区域，只在区域外点击时关闭菜单。
      if (target instanceof Node && !commandSurfaceRef.current?.contains(target)) {
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
