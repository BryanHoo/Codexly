import { useId, useRef, useState } from "react";
import { Button } from "./button.js";

type Labels = Readonly<
  Record<
    "title" | "description" | "compatibility" | "action" | "pending" | "scheduled" | "failed",
    string
  >
>;

export function HistoryCompression({
  client,
  labels,
}: Readonly<{
  client: { compressHistory(): Promise<{ status: "scheduled" }> };
  labels: Labels;
}>) {
  const titleId = useId();
  const descriptionId = useId();
  const busy = useRef(false);
  const [status, setStatus] = useState<"idle" | "pending" | "scheduled" | "failed">("idle");
  const compress = async () => {
    if (busy.current) return;
    busy.current = true;
    setStatus("pending");
    try {
      await client.compressHistory();
      // 回执不包含完成进度；只显示已提交，不启动定时查询或失效全部会话缓存。
      setStatus("scheduled");
    } catch {
      setStatus("failed");
    } finally {
      busy.current = false;
    }
  };
  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="mb-2 text-body font-semibold">
        {labels.title}
      </h2>
      <div className="rounded-surface border border-separator bg-panel px-4 py-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div
            id={descriptionId}
            className="min-w-0 flex-1 space-y-1 text-body-small text-muted-foreground"
          >
            <p>{labels.description}</p>
            <p>{labels.compatibility}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 self-end"
            aria-describedby={descriptionId}
            disabled={status === "pending"}
            onClick={() => {
              void compress();
            }}
          >
            {status === "pending" ? labels.pending : labels.action}
          </Button>
        </div>
        {status === "scheduled" ? (
          <p role="status" className="mt-3 text-body-small text-muted-foreground">
            {labels.scheduled}
          </p>
        ) : null}
        {status === "failed" ? (
          <p role="alert" className="mt-3 text-body-small text-danger">
            {labels.failed}
          </p>
        ) : null}
      </div>
    </section>
  );
}
