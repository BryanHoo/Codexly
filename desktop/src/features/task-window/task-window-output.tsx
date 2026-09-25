import { useVirtualizer } from "@tanstack/react-virtual";
import { FileCode2, Terminal, Wrench, Activity } from "lucide-react";
import { createElement, memo, useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { markdownTypographyClassName } from "../../shared/components/agent/markdown-typography.js";
import type { TaskWindowRow } from "../../protocol/task-window.js";
import { parseTaskWindowMarkdown, type InlineRun, type PreviewBlock } from "./task-window-markdown.js";

type OutputBlock = Readonly<{ key: string; kind: string; block?: PreviewBlock; text?: string }>;
type Labels = Readonly<{ terminal: string; tool: string; file: string; activity: string }>;

function InlineText({ runs }: Readonly<{ runs: readonly InlineRun[] }>) {
  return runs.map((run, index) => {
    let node: ReactNode = run.text;
    for (const mark of run.marks) {
      if (mark === "strong") node = <strong>{node}</strong>;
      else if (mark === "em") node = <em>{node}</em>;
      else if (mark === "del") node = <del>{node}</del>;
      else if (mark === "code") node = <code data-streamdown="inline-code">{node}</code>;
      else node = <span className="task-window-link">{node}</span>;
    }
    return <span key={index}>{node}</span>;
  });
}

const OutputContent = memo(function OutputContent({ item, labels }: Readonly<{ item: OutputBlock; labels: Labels }>) {
  if (!item.block) {
    const [Icon, label] = item.kind === "command" ? [Terminal, labels.terminal]
      : item.kind === "file_change" ? [FileCode2, labels.file]
      : item.kind === "tool" ? [Wrench, labels.tool] : [Activity, labels.activity];
    return <div className="task-window-operation"><Icon size={13} /><span className="task-window-operation-kind">{label}</span><span className="task-window-operation-title">{item.text}</span></div>;
  }
  const block = item.block;
  const text = <InlineText runs={block.runs} />;
  const className = `task-window-markdown task-window-markdown--${block.kind}${block.continuation ? " is-continuation" : ""}`;
  if (block.kind === "heading") return createElement(`h${block.level ?? 3}`, { className }, text);
  if (block.kind === "quote") return <blockquote className={className}>{text}</blockquote>;
  if (block.kind === "rule") return <hr className={className} />;
  return <div className={className}>{block.kind === "list" ? <span className="task-window-bullet">{block.continuation ? "" : block.prefix}</span> : null}{text}</div>;
});

export function TaskWindowOutput({ rows, labels, empty }: Readonly<{ rows: readonly TaskWindowRow[]; labels: Labels; empty: string }>) {
  const scroll = useRef<HTMLDivElement>(null);
  const pinnedToEnd = useRef(true);
  const cache = useRef(new Map<TaskWindowRow, readonly OutputBlock[]>());
  const items = useMemo(() => {
    const next = new Map<TaskWindowRow, readonly OutputBlock[]>();
    const result = rows.flatMap((row) => {
      const parsed = cache.current.get(row) ?? (
        ["message", "plan"].includes(row.kind)
          ? parseTaskWindowMarkdown(row.text).map((block, index) => ({ key: `${row.id}:${index}`, kind: row.kind, block }))
          : [{ key: row.id, kind: row.kind, text: row.text.replace(/\s+/g, " ") }]
      );
      next.set(row, parsed);
      return parsed;
    });
    // 仅缓存当前有界投影；稳定行无需再次解析，驱逐的原生行同时释放 Markdown 数据。
    cache.current = next;
    return result;
  }, [rows]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getItemKey: (index) => items[index]!.key,
    getScrollElement: () => scroll.current,
    estimateSize: () => 28,
    overscan: 0,
    anchorTo: "end",
    // 跟随由下方 pinnedToEnd 单独控制，避免虚拟列表与页面各自置底产生竞态。
    followOnAppend: false,
    scrollEndThreshold: 24,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });
  const frame = useRef(0);
  const followEnd = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (pinnedToEnd.current) virtualizer.scrollToEnd({ behavior: "auto" });
    });
  }, [virtualizer]);
  const emptyOutput = items.length === 0;
  useLayoutEffect(() => {
    if (pinnedToEnd.current) virtualizer.scrollToEnd({ behavior: "auto" });
    followEnd();
  }, [items, virtualizer, followEnd]);
  useLayoutEffect(() => {
    // 测量与缩放共用帧调度；用户上滑后停止置底，回到底部才恢复流式跟随。
    const observer = new ResizeObserver(followEnd);
    if (scroll.current) observer.observe(scroll.current);
    const content = scroll.current?.firstElementChild;
    if (content) observer.observe(content);
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); };
  }, [followEnd, emptyOutput]);
  return <div className={`task-window-output ${markdownTypographyClassName}`} ref={scroll} onScroll={(event) => {
    const element = event.currentTarget;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
    if (pinnedToEnd.current && !atEnd) {
      cancelAnimationFrame(frame.current);
      // 终止尚未完成的 scrollToEnd 测量校正，防止下一帧将用户重新拉回底部。
      virtualizer.scrollToOffset(element.scrollTop, { behavior: "auto" });
    }
    pinnedToEnd.current = atEnd;
  }}>
    {items.length === 0 ? <p className="task-window-empty">{empty}</p> : <div ref={virtualizer.containerRef} className="task-window-output-sizer">
      {virtualizer.getVirtualItems().map((entry) => <div key={entry.key} data-index={entry.index} data-task-output-block="" ref={virtualizer.measureElement} className="task-window-output-block">
        <OutputContent item={items[entry.index]!} labels={labels} />
      </div>)}
    </div>}
  </div>;
}
