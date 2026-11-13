import { useId, type ReactNode } from "react";
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
