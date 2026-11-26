import { Shimmer } from "./shimmer.js";

export function RunningReplyStatus({
  accessibleLabel,
  text,
}: Readonly<{ accessibleLabel: string; text: string }>) {
  // 提示只描述回复状态，命令与工具详情由时间线条目展示。
  return (
    <div className="flex min-w-0 items-center text-muted-foreground" role="status">
      <Shimmer aria-label={accessibleLabel} as="span" className="min-w-0 truncate text-body-small">
        {text}
      </Shimmer>
    </div>
  );
}
