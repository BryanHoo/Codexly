import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** 过程分页独立于顶部历史；关闭后保留已加载内容，重新展开不重复读取。 */
export function HistoryProcess<Page>({
  expanded,
  initialCursor,
  readPage,
  onPage,
  children,
  labels,
}: Readonly<{
  expanded: boolean;
  initialCursor: string;
  readPage: (cursor: string) => Promise<Readonly<{ page: Page; nextCursor: string | null }>>;
  onPage: (page: Page) => void;
  children: ReactNode;
  labels: Readonly<{ loading: string; more: string; retry: string }>;
}>) {
  const cursorRef = useRef<string | null>(initialCursor);
  const requestRef = useRef<object | null>(null);
  const mountedRef = useRef(true);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const load = useCallback(async () => {
    const cursor = cursorRef.current;
    if (cursor === null || requestRef.current !== null) return;
    const token = {};
    requestRef.current = token;
    setLoading(true);
    setError(false);
    try {
      const result = await readPage(cursor);
      // 卸载后的响应不写入过程 Store，也不影响其他回合的加载状态。
      if (!mountedRef.current || requestRef.current !== token) return;
      if (result.nextCursor === cursor) throw new Error("Repeated process cursor");
      onPage(result.page);
      cursorRef.current = result.nextCursor;
      setHasMore(result.nextCursor !== null);
      setLoaded(true);
    } catch {
      if (mountedRef.current && requestRef.current === token) setError(true);
    } finally {
      if (mountedRef.current && requestRef.current === token) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [onPage, readPage]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    // 只有用户展开才读取首个过程页；后续页由过程区自己的按钮触发。
    if (expanded && !loaded && !loading && !error) void load();
  }, [error, expanded, load, loaded, loading]);
  if (!expanded) return null;
  return (
    // 消息父容器按起点对齐；显式约束过程宽度，避免长命令的固有宽度撑开中栏。
    <div className="mb-4 min-w-0 w-full max-w-full space-y-4" data-turn-process="">
      {children}
      {loading ? (
        <p role="status" className="text-label text-muted-foreground">
          {labels.loading}
        </p>
      ) : null}
      {error ? (
        <button type="button" className="text-label text-danger" onClick={() => void load()}>
          {labels.retry}
        </button>
      ) : loaded && hasMore && !loading ? (
        <button
          type="button"
          className="text-label text-muted-foreground"
          onClick={() => void load()}
        >
          {labels.more}
        </button>
      ) : null}
    </div>
  );
}
