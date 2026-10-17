import type { AgentMcpServerPage, ReloadAgentMcpServersRequest } from "@codexly/protocol";
import { Button } from "./button.js";

/** 两端共用快照语义；时间只来自后端真实观测，不使用请求完成时间伪造新鲜度。 */
export function McpSnapshotControls({
  statusSource,
  observedAt,
  disabled,
  labels,
  onAction,
}: Readonly<{
  statusSource: AgentMcpServerPage["statusSource"];
  observedAt?: string | null | undefined;
  disabled: boolean;
  labels: Readonly<
    Record<"cached" | "live" | "unknownTime" | "refresh" | "reconnect" | "reload", string>
  >;
  onAction: (action: NonNullable<ReloadAgentMcpServersRequest["action"]>) => void;
}>) {
  const date = observedAt ? new Date(observedAt) : null;
  return (
    <div className="space-y-1 px-2 py-1 text-caption text-muted-foreground">
      <p>
        {statusSource === "live" ? labels.live : labels.cached}
        {" · "}
        {date && Number.isFinite(date.getTime()) ? (
          <time dateTime={observedAt ?? undefined}>{date.toLocaleString()}</time>
        ) : (
          labels.unknownTime
        )}
      </p>
      <div className="flex flex-wrap gap-1">
        {(["refresh", "reconnect", "reload"] as const).map((action) => (
          <Button
            key={action}
            disabled={disabled}
            onClick={() => {
              onAction(action);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {labels[action]}
          </Button>
        ))}
      </div>
    </div>
  );
}
