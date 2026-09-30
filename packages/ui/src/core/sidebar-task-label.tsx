type SidebarTaskLabelProps = Readonly<{
  projectName?: string | undefined;
  title: string;
}>;

export function SidebarTaskLabel({ projectName, title }: SidebarTaskLabelProps) {
  if (projectName === undefined) {
    return <span className="min-w-0 flex-1 truncate">{title}</span>;
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {/* 项目标签替代左侧固定图标，限制宽度给标题留出空间，并保持单行。 */}
      <span
        className="max-w-[40%] shrink-0 truncate rounded border border-border px-1 text-caption font-normal text-subtle-foreground"
        title={projectName}
      >
        {projectName}
      </span>
      <span className="min-w-0 flex-1 truncate" title={title}>
        {title}
      </span>
    </span>
  );
}
