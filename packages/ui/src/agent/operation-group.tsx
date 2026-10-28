import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "../core/trace.js";
import { TraceStatusIcon } from "../core/trace-status.js";
import { OperationDetailsProvider } from "./tool-details.js";

/** 五行窗口独立跟随：只写内部 scrollTop，绝不调用会推动祖先的 scrollIntoView。 */
export function OperationGroupViewport({
  children,
  label,
  closeLabel,
  onDetailOpen,
}: Readonly<{
  children: ReactNode;
  label: string;
  closeLabel: string;
  onDetailOpen?: () => void;
}>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let previousCount = content.childElementCount;
    let previousTarget = -1;
    const sync = () => {
      const count = content.childElementCount;
      const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      if (following.current && target !== previousTarget) {
        // 仅少量新步骤平滑进入；初始历史、大批追加及输出增量即时跟随，避免动画排队。
        const animate =
          previousTarget >= 0 &&
          count > previousCount &&
          count - previousCount <= 5 &&
          target - viewport.scrollTop <= viewport.clientHeight &&
          !reducedMotion.matches;
        viewport.scrollTo({ top: target, behavior: animate ? "smooth" : "instant" });
      }
      previousCount = count;
      previousTarget = target;
    };
    // 详情展开及流式输出只影响内部布局；RO 合并同帧变更，不逐 token 更新 React。
    const resize = new ResizeObserver(sync);
    resize.observe(content);
    resize.observe(viewport);
    sync();
    return () => {
      resize.disconnect();
    };
  }, []);

  const pause = () => {
    following.current = false;
    const viewport = viewportRef.current;
    if (viewport) {
      // 读者接管时立刻取消浏览器尚在进行的平滑滚动，保留当前阅读位置。
      viewport.scrollTo({ top: viewport.scrollTop, behavior: "instant" });
    }
  };

  return (
    <div className="agent-operation-window">
      <div
        aria-label={label}
        className="agent-operation-viewport"
        data-operation-viewport=""
        ref={viewportRef}
        role="region"
        tabIndex={0}
        onWheel={(event) => {
          // 内部阅读不改变外层 Message Scroller 的跟随状态，滚动边界由 CSS 阻止穿透。
          event.stopPropagation();
          pause();
        }}
        onTouchMove={(event) => {
          event.stopPropagation();
          pause();
        }}
        onPointerDown={pause}
        onClickCapture={(event) => {
          // 键盘触发的 click 没有 pointerdown；打开详情也应暂停跟随，避免跳过详情开头。
          if (event.target instanceof Element && event.target.closest("button, a")) pause();
        }}
        onKeyDown={(event) => {
          if (
            ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)
          ) {
            event.stopPropagation();
            pause();
          }
        }}
        onScroll={() => {
          const viewport = viewportRef.current;
          if (viewport && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 1) {
            following.current = true;
          }
        }}
      >
        <div className="agent-operation-list" ref={contentRef}>
          <OperationDetailsProvider
            closeLabel={closeLabel}
            {...(onDetailOpen ? { onOpen: onDetailOpen } : {})}
          >
            {children}
          </OperationDetailsProvider>
        </div>
      </div>
    </div>
  );
}

/** 两端共用 Trace 聚合；手动选择优先，后续正文只收起尚未手动干预的组。 */
export function OperationGroup({
  active,
  autoOpen,
  children,
  collapseLabel,
  expandLabel,
  runningLabel,
  summary,
  count,
  closeLabel,
}: Readonly<{
  active: boolean;
  autoOpen: boolean;
  children: ReactNode;
  collapseLabel: string;
  expandLabel: string;
  runningLabel: string;
  summary: string;
  count: number;
  closeLabel: string;
}>) {
  const [expanded, setExpanded] = useState<boolean>();
  const handleDetailOpen = useCallback(() => {
    // 查看详情视为明确的阅读选择，后续正文不再自动卸载这一组。
    setExpanded(true);
  }, []);
  const open = expanded ?? autoOpen;
  return (
    <Trace>
      <TraceCollapsible
        className="agent-operation-group group/operation w-full"
        data-operation-group=""
        data-operation-group-active={active ? "" : undefined}
        open={open}
        onOpenChange={setExpanded}
      >
        <TraceCollapsibleTrigger
          aria-label={open ? collapseLabel : expandLabel}
          className="max-w-full"
        >
          <TraceLine>
            <TraceIcon>
              <TraceStatusIcon status={active ? "running" : "completed"} />
            </TraceIcon>
            <TraceTitle>{active ? runningLabel : summary}</TraceTitle>
            {active && (
              <span className="shrink-0 text-muted-foreground/70 tabular-nums">{count}</span>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="agent-operation-group-content">
          <OperationGroupViewport
            label={summary}
            closeLabel={closeLabel}
            onDetailOpen={handleDetailOpen}
          >
            {children}
          </OperationGroupViewport>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
