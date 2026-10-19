import type { AgentContextUsage } from "@codexly/protocol";

/** 两端共用同一统计口径；窗口未知时仍显示已用量，不伪造百分比。 */
export function ContextUsageSummary({
  usage,
  label,
  unknownLabel,
}: Readonly<{ usage: AgentContextUsage; label: string; unknownLabel: string }>) {
  const percent =
    usage.contextWindow === null
      ? null
      : Math.round((usage.usedTokens / usage.contextWindow) * 100);
  return (
    <section
      aria-label={label}
      className="space-y-2 rounded-control bg-control px-3 py-2.5"
      data-context-usage=""
    >
      <div className="flex items-center justify-between gap-2 text-label">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {percent === null ? unknownLabel : `${String(percent)}%`}
        </span>
      </div>
      {percent === null ? null : (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, percent)}
          className="h-1 overflow-hidden rounded-full bg-panel"
        >
          <div
            className="h-full bg-brand"
            style={{ width: `${String(Math.min(100, percent))}%` }}
          />
        </div>
      )}
      <p className="text-caption tabular-nums text-muted-foreground">
        {usage.usedTokens.toLocaleString()}
        {usage.contextWindow === null ? "" : ` / ${usage.contextWindow.toLocaleString()}`}
      </p>
    </section>
  );
}
