import { LockKeyhole } from "lucide-react";
import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";

export function ComposerInteractionBoundary({ access, children }: Readonly<{
  access: TaskRuntimeView["writeAccess"];
  children: ReactNode;
}>) {
  const { t } = useTranslation("workbench");
  const disabled = access !== undefined && access !== "writable";
  const blockInteraction = (event: SyntheticEvent) => {
    if (!disabled) return;
    // 捕获阶段同时拦截已有 Portal 菜单的事件，不能只靠遮罩阻挡鼠标。
    event.preventDefault();
    event.stopPropagation();
  };
  return <div className="relative shrink-0" data-composer-write-access={access}>
    <fieldset className="m-0 min-w-0 border-0 p-0" disabled={disabled} inert={disabled}
      onClickCapture={blockInteraction} onKeyDownCapture={blockInteraction}
      onSubmitCapture={blockInteraction} onChangeCapture={blockInteraction}>
      {children}
    </fieldset>
    {access === "external" ? (
      <div className="absolute inset-x-5 inset-y-0 z-20 mx-auto flex max-w-content items-center justify-center gap-2 rounded-surface bg-content/90 px-4 text-body-small text-muted-foreground"
        role="status">
        <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
        <span>{t("composer.threadBusy")}</span>
      </div>
    ) : null}
  </div>;
}
