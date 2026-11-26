import { useId, type ReactNode } from "react";
import { cn } from "../lib/utils.js";

/** 表单与确认弹窗共用右对齐操作栏，窄屏换行时保留按钮顺序。 */
export function SettingsActions({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div
      data-slot="settings-actions"
      className={cn("flex flex-wrap items-center justify-end gap-2", className)}
    >
      {children}
    </div>
  );
}
/** 设置模块统一外观；ACP 与常规设置共享同一张卡片和字段分隔样式。 */
export function SettingsCard({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="divide-y divide-separator rounded-surface border border-separator bg-panel px-4">
      {children}
    </div>
  );
}
export function SettingsGroup({
  children,
  title,
  description,
}: Readonly<{ children: ReactNode; title: string; description?: string }>) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2
        id={id}
        className={`${description === undefined ? "mb-2" : "mb-1"} text-body font-semibold`}
      >
        {title}
      </h2>
      {description === undefined ? null : (
        <p className="mb-3 text-body-small text-muted-foreground">{description}</p>
      )}
      <SettingsCard>{children}</SettingsCard>
    </section>
  );
}
