import { ArrowUp, FilePlus2, ImagePlus, LoaderCircle, Paperclip, Plus, Square } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../core/button.js";

import {
  isPromptInputComposing,
  isPromptInputNewlineShortcut,
  usePromptInputAttachments,
} from "./prompt-input-context.js";
import type { PromptInputAttachmentKind } from "./prompt-input-context.js";

type PromptInputSectionProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputCommand({ className = "", ...props }: PromptInputSectionProps) {
  return (
    <div
      className={`overflow-hidden rounded-surface border border-separator-strong bg-raised shadow-floating ${className}`}
      data-prompt-input-command=""
      role="listbox"
      {...props}
    />
  );
}

export function PromptInputCommandList({ className = "", ...props }: PromptInputSectionProps) {
  return (
    <div
      className={`max-h-96 overflow-y-auto p-1 ${className}`}
      data-prompt-input-command-list=""
      {...props}
    />
  );
}

type PromptInputCommandGroupProps = PromptInputSectionProps & { label: string };

export function PromptInputCommandGroup({
  children,
  className = "",
  label,
  ...props
}: PromptInputCommandGroupProps) {
  return (
    <div aria-label={label} className={className} role="group" {...props}>
      <div className="px-2 py-1.5 text-caption font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

type PromptInputCommandItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  selected?: boolean;
};

export function PromptInputCommandItem({
  active = false,
  className = "",
  onMouseDown,
  selected = false,
  type = "button",
  ...props
}: PromptInputCommandItemProps) {
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) {
      // 键盘切换高亮项时，让滚动容器始终露出当前选项。
      itemRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <Button
      variant="ghost"
      aria-selected={selected}
      className={`flex h-auto min-h-8 w-full items-center gap-2 whitespace-normal rounded-control px-2 py-2 text-left text-body-small text-foreground transition-colors hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${active ? "bg-control-active" : ""} ${className}`}
      data-active={active || undefined}
      onMouseDown={(event) => {
        // 保留输入框焦点，避免鼠标选择命令时丢失光标上下文。
        event.preventDefault();
        onMouseDown?.(event);
      }}
      ref={itemRef}
      role="option"
      type={type}
      {...props}
    />
  );
}

export function PromptInputCommandEmpty({ className = "", ...props }: PromptInputSectionProps) {
  return (
    <div
      className={`px-3 py-5 text-center text-body-small text-muted-foreground ${className}`}
      role="status"
      {...props}
    />
  );
}

export function PromptInputBody({ className = "", ...props }: PromptInputSectionProps) {
  return <div className={`px-3 pt-2 ${className}`} {...props} />;
}

export function PromptInputHeader({ className = "", ...props }: PromptInputSectionProps) {
  return <div className={`px-3 pt-2 ${className}`} {...props} />;
}

export function PromptInputFooter({ className = "", ...props }: PromptInputSectionProps) {
  return (
    <div
      className={`flex min-h-10 items-center justify-between gap-2 px-2 pb-2 ${className}`}
      {...props}
    />
  );
}

export function PromptInputTools({ className = "", ...props }: PromptInputSectionProps) {
  return <div className={`flex min-w-0 items-center gap-1 ${className}`} {...props} />;
}

type PromptInputTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  function PromptInputTextarea(
    { className = "", name = "message", onKeyDown, rows = 2, ...props },
    forwardedRef,
  ) {
    return (
      <textarea
        className={`max-h-40 min-h-12 w-full resize-none bg-transparent px-1 py-1 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed ${className}`}
        name={name}
        onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
          onKeyDown?.(event);
          if (
            !event.defaultPrevented &&
            event.key === "Enter" &&
            !isPromptInputNewlineShortcut(event) &&
            !isPromptInputComposing(event.nativeEvent)
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        ref={forwardedRef}
        rows={rows}
        {...props}
      />
    );
  },
);

type PromptInputActionAddAttachmentsProps = PromptInputButtonProps & {
  label?: string;
  onSelectKind: (kind: PromptInputAttachmentKind) => void;
};

export function PromptInputActionAddAttachments({
  children,
  label,
  onClick,
  onSelectKind,
  ...props
}: PromptInputActionAddAttachmentsProps) {
  const attachments = usePromptInputAttachments();
  const { t } = useTranslation("conversation");
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const disabled = props.disabled === true || attachments.disabled;
  const accessibleLabel = label ?? t("agentComponents.addImageOrFile");

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <PromptInputButton
        {...props}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={accessibleLabel}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) setOpen((current) => !current);
        }}
        title={accessibleLabel}
      >
        {children ?? <Paperclip aria-hidden="true" className="size-3.5" />}
      </PromptInputButton>
      <div
        className="absolute bottom-9 left-0 z-50 min-w-36 rounded-control border border-separator-strong bg-raised p-1 shadow-floating"
        data-floating-surface
        hidden={!open}
        role="menu"
      >
        <Button
          variant="ghost"
          className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-label text-foreground hover:bg-control-hover"
          onClick={() => {
            setOpen(false);
            onSelectKind("image");
          }}
          role="menuitem"
          type="button"
        >
          <ImagePlus aria-hidden="true" className="size-4 text-muted-foreground" />
          {t("agentComponents.addImage")}
        </Button>
        <Button
          variant="ghost"
          className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-label text-foreground hover:bg-control-hover"
          onClick={() => {
            setOpen(false);
            onSelectKind("file");
          }}
          role="menuitem"
          type="button"
        >
          <FilePlus2 aria-hidden="true" className="size-4 text-muted-foreground" />
          {t("agentComponents.addFile")}
        </Button>
      </div>
    </div>
  );
}

type PromptInputButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function PromptInputButton({
  children,
  className = "",
  type = "button",
  ...props
}: PromptInputButtonProps) {
  return (
    <Button
      className={`max-workbench:min-w-11 ${className}`}
      size="sm"
      type={type}
      variant="ghost"
      {...props}
    >
      {children ?? <Plus className="size-3.5" aria-hidden="true" />}
    </Button>
  );
}

type PromptInputSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function PromptInputSelect({ className = "", ...props }: PromptInputSelectProps) {
  return (
    <select
      className={`h-7 w-auto max-w-40 appearance-none rounded-control border-0 bg-transparent px-1.5 text-label text-muted-foreground outline-none [field-sizing:content] hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-45 max-workbench:h-11 ${className}`}
      {...props}
    />
  );
}

type PromptInputSubmitProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  status: "failed" | "idle" | "reconnecting" | "running" | "submitting";
};

export function PromptInputSubmit({
  children,
  className = "",
  status,
  type = "submit",
  ...props
}: PromptInputSubmitProps) {
  const pending = status === "reconnecting" || status === "submitting";

  return (
    <Button className={className} size="icon-compact" type={type} variant="inverse" {...props}>
      {children ??
        (status === "running" ? (
          <Square className="size-3.5 fill-current" aria-hidden="true" />
        ) : pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowUp className="size-4" aria-hidden="true" />
        ))}
    </Button>
  );
}
