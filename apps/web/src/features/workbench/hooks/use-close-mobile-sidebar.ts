import { useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, type RefObject } from "react";

import { sidebarOverlayQuery } from "../components/workbench-panel-layout.js";

export function useCloseMobileSidebar(
  sidebarRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const href = useLocation({ select: (location) => location.href });
  const previousHref = useRef(href);
  const closeOnMobile = useCallback(() => {
    if (window.matchMedia(sidebarOverlayQuery).matches) onClose();
  }, [onClose]);
  useEffect(() => {
    // 只响应实际路由变更，避免加载或预取完成事件误关刚打开的侧栏。
    if (previousHref.current !== href) closeOnMobile();
    previousHref.current = href;
  }, [href, closeOnMobile]);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    const closeAfterLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      // 当前任务的重复选择也要收起；菜单和展开文件夹动作保持原样。
      if (link && !link.hasAttribute("target")) closeOnMobile();
    };
    sidebar?.addEventListener("click", closeAfterLink);
    return () => sidebar?.removeEventListener("click", closeAfterLink);
  }, [closeOnMobile, sidebarRef]);
  return closeOnMobile;
}
