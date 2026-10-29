import {
  Children,
  isValidElement,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "../core/button.js";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../core/hover-card.js";

type InlineCitationProps = ComponentProps<"a"> & {
  newTabLabel: string;
};

function sourceHostname(href: string | undefined): string | null {
  // 只展示有明确目标的网页来源，保留邮件、页内锚点及流式未闭合链接的原有语义。
  if (href === undefined || !/^https?:\/\//iu.test(href)) return null;
  try {
    return new URL(href).hostname.replace(/^www\./iu, "") || null;
  } catch {
    return null;
  }
}

function containsImage(children: ReactNode): boolean {
  return Children.toArray(children).some(
    (child) =>
      isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child) &&
      (child.type === "img" ||
        child.props.node?.tagName === "img" ||
        containsImage(child.props.children)),
  );
}

export function InlineCitation({
  children,
  href,
  newTabLabel,
  title,
  ...props
}: InlineCitationProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const hostname = sourceHostname(href);
  if (hostname === null || containsImage(children)) {
    return (
      <a {...props} href={href} title={title} rel="noopener noreferrer" target="_blank">
        {children}
      </a>
    );
  }

  return (
    // 对齐官方的短悬停延迟；浮层按需挂载，不抓取网页或为每个来源建立预览请求。
    <HoverCard open={open} onOpenChange={setOpen} openDelay={10} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Button
          aria-expanded={open}
          className="mx-0.5 inline-flex max-w-full align-baseline rounded-pill text-caption"
          data-inline-citation="true"
          ref={triggerRef}
          size="toolbar"
          type="button"
          variant="secondary"
          onFocus={(event) => {
            // 键盘立即打开，并取消 Radix 的延迟打开，避免 Escape 关闭后被旧定时器重新展开。
            event.preventDefault();
            setOpen(true);
          }}
          onBlur={(event) => {
            if (event.relatedTarget === linkRef.current) event.preventDefault();
          }}
          onPointerLeave={(event) => {
            if (event.currentTarget === document.activeElement) event.preventDefault();
          }}
          onPointerUp={(event) => {
            // Radix 会阻止 touchstart 的默认导航，真实触屏由 pointerup 展开来源。
            if (event.pointerType === "touch") setOpen(true);
          }}
          onClick={() => {
            // 触屏没有悬停；首次点击只展开来源，导航始终由卡片中的真实链接触发。
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Tab" && !event.shiftKey && open && linkRef.current !== null) {
              // Radix 将预览中的链接设为 tabindex=-1；显式衔接 Tab，保留可访问的来源动作。
              event.preventDefault();
              linkRef.current.focus();
            }
          }}
        >
          <span className="truncate">{hostname}</span>
          {children ? <span className="sr-only"> {children}</span> : null}
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="flex max-w-[calc(100vw-2rem)] flex-col gap-1 break-words"
        onEscapeKeyDown={() => {
          triggerRef.current?.focus();
          setOpen(false);
        }}
        onPointerLeave={(event) => {
          if (event.currentTarget.contains(document.activeElement)) event.preventDefault();
        }}
      >
        <div className="font-medium">{children ?? title ?? hostname}</div>
        {title && children ? <p className="text-muted-foreground">{title}</p> : null}
        <a
          {...props}
          className="text-caption text-muted-foreground underline-offset-4 [overflow-wrap:anywhere] hover:underline"
          href={href}
          ref={linkRef}
          onBlur={(event) => {
            props.onBlur?.(event);
            if (event.relatedTarget !== triggerRef.current) setOpen(false);
          }}
          onKeyDown={(event) => {
            props.onKeyDown?.(event);
            if (!event.defaultPrevented && event.key === "Tab" && event.shiftKey) {
              event.preventDefault();
              triggerRef.current?.focus();
            }
          }}
          rel="noopener noreferrer"
          target="_blank"
        >
          {href}
          <span className="sr-only"> ({newTabLabel})</span>
        </a>
      </HoverCardContent>
    </HoverCard>
  );
}
