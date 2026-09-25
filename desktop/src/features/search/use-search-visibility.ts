import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type RefObject, type UIEvent } from "react";

/** 保留搜索会话而卸载弹窗 DOM；关闭时取消请求，重新打开只恢复焦点与滚动。 */
export function useSearchVisibility(
  open: boolean,
  inputRef: RefObject<HTMLInputElement | null>,
  listRef: RefObject<HTMLDivElement | null>,
  actionAbortRef: RefObject<AbortController | null>,
) {
  const cache = useQueryClient();
  const returnFocus = useRef<HTMLElement | null>(null);
  const scrollTop = useRef(0);
  useEffect(() => {
    if (!open) {
      actionAbortRef.current?.abort();
      void cache.cancelQueries({ queryKey: ["global-search"] });
    }
  }, [actionAbortRef, cache, open]);
  useEffect(() => () => actionAbortRef.current?.abort(), [actionAbortRef]);
  return {
    onOpenAutoFocus: (event: Event) => {
      event.preventDefault();
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      inputRef.current?.focus();
      inputRef.current?.select();
      if (listRef.current) listRef.current.scrollTop = scrollTop.current;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      returnFocus.current?.focus();
    },
    onScroll: (event: UIEvent<HTMLDivElement>) => {
      scrollTop.current = event.currentTarget.scrollTop;
    },
    resetScroll: () => { scrollTop.current = 0; },
  };
}
