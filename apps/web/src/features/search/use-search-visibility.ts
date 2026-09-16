import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type RefObject, type UIEvent } from "react";

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
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      returnFocus.current?.focus();
    },
    onOpenAutoFocus: (event: Event) => {
      event.preventDefault();
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      inputRef.current?.focus();
      inputRef.current?.select();
      if (listRef.current !== null) listRef.current.scrollTop = scrollTop.current;
    },
    onScroll: (event: UIEvent<HTMLDivElement>) => {
      scrollTop.current = event.currentTarget.scrollTop;
    },
    resetScroll: () => {
      scrollTop.current = 0;
    },
  };
}
