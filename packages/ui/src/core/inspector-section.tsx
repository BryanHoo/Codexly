import type { ReactNode } from "react";

/** 右栏上下文共用标题层级、图标尺寸和纵向节奏，两端只注入内容及操作。 */
export function InspectorSection({
  action,
  children,
  icon,
  title,
}: Readonly<{
  action?: ReactNode;
  children: ReactNode;
  icon: ReactNode;
  title: string;
}>) {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2 text-xs font-medium text-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <h3 className="truncate">{title}</h3>
        </div>
        {action}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}
