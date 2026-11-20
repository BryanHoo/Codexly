import { LockKeyhole } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode, type SyntheticEvent } from "react";

export function ComposerInteractionBoundary({
  access,
  children,
  message,
}: Readonly<{
  access?: "checking" | "writable" | "external" | "unavailable" | undefined;
  message: string;
  children: ReactNode;
}>) {
  const disabled = access !== undefined && access !== "writable";
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  useLayoutEffect(() => {
    if (!disabled) return;
    const active = fieldsetRef.current?.ownerDocument.activeElement;
    // WebKit 不一定在 fieldset 变为 disabled/inert 时移走已有焦点；锁定前的编辑器必须主动失焦。
    // 只处理当前边界内的元素，保留其他分栏或弹窗正在使用的焦点。
    if (active instanceof HTMLElement && fieldsetRef.current?.contains(active)) active.blur();
  }, [disabled]);
  const blockInteraction = (event: SyntheticEvent) => {
    if (!disabled) return;
    // 捕获阶段同时拦截已有 Portal 菜单的事件，不能只靠遮罩阻挡鼠标。
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div className="relative shrink-0" data-composer-write-access={access}>
      <fieldset
        ref={fieldsetRef}
        className="m-0 min-w-0 border-0 p-0"
        disabled={disabled}
        inert={disabled}
        onClickCapture={blockInteraction}
        onKeyDownCapture={blockInteraction}
        onSubmitCapture={blockInteraction}
        onChangeCapture={blockInteraction}
      >
        {children}
      </fieldset>
      {access === "external" ? (
        <span className="sr-only" role="status" data-composer-write-announcement="">
          {message}
        </span>
      ) : null}
    </div>
  );
}

/** 视觉遮罩放在编辑框中；可访问提示由 inert 边界外的状态区单独播报。 */
export function ComposerWriteAccessNotice({
  access,
  message,
}: Readonly<{
  access?: "checking" | "writable" | "external" | "unavailable" | undefined;
  message: string;
}>) {
  if (access !== "external") return null;
  return (
    <div
      aria-hidden="true"
      data-composer-write-notice=""
      style={{
        backgroundImage: "linear-gradient(var(--ui-color-control), var(--ui-color-control))",
      }}
      className="absolute inset-0 z-20 flex items-center justify-center rounded-surface bg-raised px-5 py-4 text-body-small text-muted-foreground"
    >
      <div className="flex max-w-full items-center justify-center gap-2">
        <LockKeyhole className="size-4 shrink-0" />
        <span className="min-w-0 text-center leading-relaxed">{message}</span>
      </div>
    </div>
  );
}
