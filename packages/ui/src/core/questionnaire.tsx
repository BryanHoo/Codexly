import { ChevronLeft, ChevronRight, LoaderCircle, MessageCircleQuestion } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "../lib/utils.js";
import { Button } from "./button.js";

/** 文案由平台注入，公共组件不依赖任一端的翻译或运行时。 */
export type QuestionnaireLabels = Readonly<{
  previous: string;
  next: string;
  progress: (current: number, total: number) => string;
}>;

export type QuestionnaireItem = Readonly<{
  id: string;
  title: ReactNode;
  description?: ReactNode;
  content: ReactNode;
  complete?: boolean | undefined;
}>;

/** 借鉴 shadcn Questionnaire 的组合与原生控件语义，沿用项目现有主题。 */
export function QuestionnaireCard({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="questionnaire-card"
      className={cn("min-w-0 w-full rounded-surface border border-separator bg-control", className)}
      {...props}
    />
  );
}

export function QuestionnaireHeader({ children, className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-1.5 text-label font-medium text-foreground",
        className,
      )}
      {...props}
    >
      <MessageCircleQuestion aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
      <h3 className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</h3>
    </div>
  );
}

export function QuestionnaireActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-1.5", className)} {...props} />
  );
}

export function Questionnaire({
  items,
  labels,
  onSubmit,
  submitLabel,
  disabled = false,
  submitDisabled = false,
  submitting = false,
  actions,
  feedback,
  className,
  title,
  description,
}: Readonly<{
  items: readonly QuestionnaireItem[];
  labels: QuestionnaireLabels;
  onSubmit: () => void;
  submitLabel: ReactNode;
  disabled?: boolean;
  submitDisabled?: boolean;
  submitting?: boolean;
  actions?: ReactNode;
  feedback?: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
}>) {
  const [activeId, setActiveId] = useState(items[0]?.id);
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === activeId),
  );
  const active = items[activeIndex];
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const focusOnNavigation = useRef(false);
  const invalidControl = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(
    null,
  );
  const locked = disabled || submitting;

  useLayoutEffect(() => {
    if (!focusOnNavigation.current) return;
    focusOnNavigation.current = false;
    const fieldset = formRef.current?.querySelector<HTMLFieldSetElement>(
      `fieldset[data-questionnaire-index="${String(activeIndex)}"]`,
    );
    // 切题只移动本问卷内部焦点，不触发页面或时间线跳动，也不抢占初次挂载时的输入框焦点。
    fieldset?.focus({ preventScroll: true });
    if (fieldset?.parentElement) fieldset.parentElement.scrollTop = 0;
    invalidControl.current?.reportValidity();
    invalidControl.current = null;
  }, [activeIndex, activeId]);

  const navigate = (index: number) => {
    const item = items[index];
    if (item === undefined) return;
    focusOnNavigation.current = true;
    setActiveId(item.id);
  };
  const validate = (index: number) => {
    const fieldset = formRef.current?.querySelector<HTMLFieldSetElement>(
      `fieldset[data-questionnaire-index="${String(index)}"]`,
    );
    const invalid = Array.from(
      fieldset?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input, select, textarea",
      ) ?? [],
    ).find((control) => !control.checkValidity());
    if (items[index]?.complete === false || invalid) {
      if (index !== activeIndex) {
        invalidControl.current = invalid ?? null;
        navigate(index);
      } else if (invalid) {
        invalid.reportValidity();
      }
      return false;
    }
    return true;
  };

  return (
    <form
      ref={formRef}
      noValidate
      data-slot="questionnaire"
      className={cn("flex max-h-[min(28vh,16rem)] min-w-0 flex-col", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (locked) return;
        // Enter 与“下一题”一致；所有步骤通过校验后才允许最终发送，隐藏项不会吞掉原生校验焦点。
        if (activeIndex < items.length - 1) {
          if (validate(activeIndex)) navigate(activeIndex + 1);
          return;
        }
        for (let index = 0; index < items.length; index++) if (!validate(index)) return;
        if (!submitDisabled) onSubmit();
      }}
    >
      {title ? <QuestionnaireHeader>{title}</QuestionnaireHeader> : null}
      {description ? (
        <div className="mt-1.5 whitespace-pre-wrap text-label text-muted-foreground [overflow-wrap:anywhere]">
          {description}
        </div>
      ) : null}
      {items.length > 1 ? (
        <div
          role="progressbar"
          aria-label={labels.progress(activeIndex + 1, items.length)}
          aria-valuemin={1}
          aria-valuemax={items.length}
          aria-valuenow={activeIndex + 1}
          className="mb-1.5 flex shrink-0 items-center gap-2 pt-0.5 text-meta text-muted-foreground"
        >
          <span className="shrink-0 tabular-nums">
            {labels.progress(activeIndex + 1, items.length)}
          </span>
          <div aria-hidden="true" className="flex min-w-0 flex-1 gap-1">
            {items.map((item, index) => (
              <span
                key={item.id}
                className={cn(
                  "h-0.5 min-w-0 flex-1 rounded-pill",
                  index <= activeIndex ? "bg-brand" : "bg-separator",
                )}
              />
            ))}
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          "min-h-0 flex-auto overflow-y-auto overscroll-contain pr-0.5",
          (title ?? description) && "mt-1.5",
        )}
      >
        {items.map((item, index) => (
          <fieldset
            key={item.id}
            hidden={index !== activeIndex}
            inert={index !== activeIndex}
            disabled={locked}
            data-questionnaire-index={index}
            tabIndex={-1}
            aria-describedby={
              item.description ? `${prefix}-${String(index)}-description` : undefined
            }
            className="min-w-0 space-y-1 outline-none"
          >
            <legend className="mb-1.5 w-full min-w-0 whitespace-pre-wrap text-label font-medium text-foreground [overflow-wrap:anywhere]">
              {item.title}
            </legend>
            {item.description ? (
              <p
                id={`${prefix}-${String(index)}-description`}
                className="text-meta text-muted-foreground [overflow-wrap:anywhere]"
              >
                {item.description}
              </p>
            ) : null}
            {item.content}
          </fieldset>
        ))}
      </div>
      {feedback ? <div className="mt-1.5 text-meta text-muted-foreground">{feedback}</div> : null}
      <QuestionnaireActions className="mt-2 shrink-0 border-t border-separator pt-1.5">
        {activeIndex > 0 ? (
          <Button
            type="button"
            size="toolbar"
            variant="ghost"
            disabled={locked}
            onClick={() => {
              navigate(activeIndex - 1);
            }}
          >
            <ChevronLeft aria-hidden="true" className="size-3" />
            {labels.previous}
          </Button>
        ) : null}
        <div className="flex-1" />
        {actions}
        {activeIndex < items.length - 1 ? (
          <Button type="submit" size="toolbar" disabled={locked || active?.complete === false}>
            {labels.next}
            <ChevronRight aria-hidden="true" className="size-3" />
          </Button>
        ) : (
          <Button type="submit" size="toolbar" disabled={locked || submitDisabled}>
            {submitting ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-3 animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {submitLabel}
          </Button>
        )}
      </QuestionnaireActions>
    </form>
  );
}
