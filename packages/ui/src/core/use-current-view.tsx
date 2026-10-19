import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

/** 异步响应可以更新任务缓存，但只有发起请求的视图仍有效时才允许选中任务或导航。 */
export function useCurrentView(scope: string): () => boolean {
  // 每次切换都产生新身份；离开后又返回同一路由，也不能接管旧请求的导航。
  const view = useMemo(() => ({ scope }), [scope]);
  const current = useRef<typeof view | null>(view);
  useLayoutEffect(() => {
    current.current = view;
    return () => {
      current.current = null;
    };
  }, [view]);
  return useCallback(() => current.current === view, [view]);
}
