import { useCallback, useEffect, useRef, useState } from "react";
import type { AcpPlanHistory as History } from "@codexly/protocol/acp-plan-api";
import type { AcpPlanUiClient, PlanLabels } from "./acp-plan-contract.js";
import { Button } from "./button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./dialog.js";
export type OpenAcpPlanTask = (
  projectId: string,
  taskId: string,
  signal: AbortSignal,
) => Promise<void>;
interface Props {
  client: Pick<AcpPlanUiClient, "readAcpPlanHistory" | "subscribeAcpPlans">;
  id: string;
  name: string;
  labels: PlanLabels;
  language?: string;
  onOpenTask: OpenAcpPlanTask;
  onClose: () => void;
}
/** 只在用户打开时读取有限运行摘要；关闭取消读取，不能借未知状态发起新任务。 */
export function AcpPlanHistory({
  client,
  id,
  name,
  labels: l,
  language,
  onOpenTask,
  onClose,
}: Props) {
  const [history, setHistory] = useState<History>();
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const query = useRef<AbortController | undefined>(undefined);
  const refreshQueued = useRef(false);
  const navigation = useRef<AbortController | undefined>(undefined);
  const load = useCallback(
    async function readHistory(background = false): Promise<void> {
      if (background && query.current) {
        refreshQueued.current = true;
        return;
      }
      // await 期间外部事件可能重新置位；读取函数获取最新的失效信号。
      const needsRefresh = () => refreshQueued.current;
      refreshQueued.current = false;
      query.current?.abort();
      const request = new AbortController();
      query.current = request;
      setLoading(true);
      setError("");
      try {
        const result = await client.readAcpPlanHistory(id, { signal: request.signal });
        if (active.current && !request.signal.aborted) setHistory(result);
      } catch (cause) {
        if (active.current && !request.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active.current && query.current === request) {
          query.current = undefined;
          setLoading(false);
          if (needsRefresh()) void readHistory(true);
        }
      }
    },
    [client, id],
  );
  useEffect(() => {
    active.current = true;
    const unsubscribe = client.subscribeAcpPlans(() => {
      void load(true);
    });
    void load(true);
    return () => {
      active.current = false;
      query.current?.abort();
      query.current = undefined;
      refreshQueued.current = false;
      unsubscribe();
      navigation.current?.abort();
    };
  }, [client, load]);
  const open = async (taskId: string) => {
    if (!history || navigation.current) return;
    const request = new AbortController();
    navigation.current = request;
    setOpening(true);
    setError("");
    try {
      await onOpenTask(history.projectId, taskId, request.signal);
    } catch (cause) {
      if (active.current && !request.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (navigation.current === request) {
        navigation.current = undefined;
        if (active.current) setOpening(false);
      }
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent closeLabel={l.close} className="flex max-h-[85dvh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{l.history}</DialogTitle>
          <DialogDescription className="break-words">{name}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <Button
            variant="ghost"
            disabled={loading || opening}
            onClick={() => {
              void load();
            }}
          >
            {l.refreshHistory}
          </Button>
          {loading ? <p role="status">{l.loading}</p> : null}
          {error ? (
            <p role="alert" className="break-words text-destructive">
              {error}
            </p>
          ) : null}
          {history && !history.data.length ? <p>{l.noRuns}</p> : null}
          <ol className="flex flex-col divide-y divide-separator">
            {history?.data.map((run) => (
              <li key={run.runId} className="flex min-w-0 flex-col gap-1 py-3 text-label">
                <span className="font-medium">{l[run.status]}</span>
                <span className="text-caption text-muted-foreground">
                  {new Date(run.claimedAt).toLocaleString(language)} · {l.definitionRevision}{" "}
                  {run.definitionRevision}
                </span>
                {run.error ? <p className="whitespace-pre-wrap break-words">{run.error}</p> : null}
                {run.taskId ? (
                  <Button
                    variant="ghost"
                    disabled={opening}
                    onClick={() => {
                      if (run.taskId) void open(run.taskId);
                    }}
                  >
                    {l.openTask}
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}
