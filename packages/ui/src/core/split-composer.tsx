import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, Square, SquarePen } from "lucide-react";
import { Button } from "./button.js";
import { SplitPaneContext } from "./split-workspace.js";

const RevealComposerContext = createContext<(() => void) | undefined>(undefined);
export const useRevealSplitComposer = () => useContext(RevealComposerContext);

export function SplitComposer({
  children,
  label,
  expandLabel,
  collapseLabel,
  stopLabel,
  onInterrupt,
  interruptible,
  notice,
  footer,
  collapsible = true,
}: Readonly<{
  children: ReactNode;
  label: string;
  expandLabel: string;
  collapseLabel: string;
  stopLabel: string;
  onInterrupt: () => void;
  interruptible: boolean;
  notice?: ReactNode;
  footer: (controls: ReactNode) => ReactNode;
  collapsible?: boolean;
}>) {
  // 定时任务等无底栏编辑器不参与分屏收起，避免隐藏后失去展开入口。
  const pane = useContext(SplitPaneContext);
  const multiple = (pane?.multiple ?? false) && collapsible;
  // 新建草稿直接提供输入区域；已有任务仍默认收起，后续手动切换独立保留。
  const defaultExpanded = pane?.pane.draftId !== undefined;
  const [disclosure, setDisclosure] = useState({ multiple, expanded: defaultExpanded });
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(false);
  // 只在进入/退出分屏时重置，增减相邻窗口、切换焦点和流式更新均保留本窗选择。
  if (disclosure.multiple !== multiple) {
    setDisclosure({ multiple, expanded: defaultExpanded });
  }
  const expanded = !multiple || (disclosure.multiple === multiple && disclosure.expanded);
  const reveal = useCallback(() => {
    if (expanded) return;
    focusRequested.current = true;
    setDisclosure((previous) => ({ ...previous, expanded: true }));
  }, [expanded]);
  useLayoutEffect(() => {
    if (!expanded || !focusRequested.current) return;
    focusRequested.current = false;
    // 等 hidden 移除后再聚焦；文件引用等外部编辑动作同样能唤起收起的输入框。
    contentRef.current
      ?.querySelector<HTMLTextAreaElement>("[data-prompt-skill-editor]")
      ?.focus({ preventScroll: true });
  }, [expanded]);

  const controls = multiple ? (
    <>
      {!expanded && interruptible ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={stopLabel}
          title={stopLabel}
          onClick={onInterrupt}
        >
          <Square aria-hidden="true" className="size-3.5 fill-current" />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={expanded ? collapseLabel : expandLabel}
        title={expanded ? collapseLabel : expandLabel}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => {
          if (expanded) setDisclosure({ multiple, expanded: false });
          else reveal();
        }}
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" className="size-4" />
        ) : (
          <SquarePen aria-hidden="true" className="size-4" />
        )}
      </Button>
    </>
  ) : null;

  return (
    <section
      aria-label={label}
      className="shrink-0 bg-content px-1 pb-2 max-[360px]:px-0 sm:px-5"
      data-split-composer-expanded={expanded}
    >
      <div className="mx-auto w-full max-w-content">{notice}</div>
      {/* 保持编辑器、附件和队列挂载，收起不销毁草稿、不暂停发送副作用。 */}
      <RevealComposerContext value={reveal}>
        <div id={contentId} ref={contentRef} hidden={!expanded} inert={!expanded}>
          {children}
        </div>
        {footer(controls)}
      </RevealComposerContext>
    </section>
  );
}
