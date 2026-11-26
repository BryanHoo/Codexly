import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcpScheduledConfigView, ScheduledTask } from "@codexly/protocol";
import { Button } from "./button.js";
import { AcpScheduledConfigDialog } from "./acp-scheduled-config-dialog.js";
import {
  scheduledConfigLabels,
  type AcpScheduledConfigClient,
} from "./acp-scheduled-config-contract.js";

type Plan = Pick<
  ScheduledTask,
  "id" | "name" | "projectId" | "projectName" | "prompt" | "runs" | "nextRunAtUnixMs" | "enabled"
>;

/** 历史计划只读投影复用原数据；ACP 配置独立保存，旧版仍能读取原计划与运行记录。 */
export function AcpScheduledTask({
  client,
  task,
  language,
  onRunNow,
  onOpenRun,
  onEnabledChange,
  openingRun,
  attachments = [],
}: Readonly<{
  client: AcpScheduledConfigClient;
  task: Plan;
  language?: string | undefined;
  onRunNow: (id: string) => Promise<void>;
  onOpenRun: (projectId: string, taskId: string) => void;
  onEnabledChange?: ((id: string, enabled: boolean) => void) | undefined;
  openingRun?: boolean | undefined;
  attachments?: readonly { id: string; name: string }[];
}>) {
  const labels = scheduledConfigLabels[language?.startsWith("en") ? "en" : "zh-CN"];
  const queryClient = useQueryClient();
  const key = ["scheduled-tasks", "acp-config", task.id] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => client.getAcpScheduledConfig(task.id, { signal }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [editing, setEditing] = useState<AcpScheduledConfigView>();
  const [running, setRunning] = useState(false);
  const runBusy = useRef(false);
  const [error, setError] = useState("");
  const view = query.data;
  const canEdit =
    view?.projectId === task.projectId &&
    view.canEdit &&
    !task.runs.some((run) => ["running", "unknown", "cleanup_pending"].includes(run.status));
  const format = (value: number | null) =>
    value === null ? "—" : new Date(value).toLocaleString(language);
  return (
    <section className="scheduled-task-editor">
      <div
        className="scheduled-task-editor__toolbar"
        style={{ height: "auto", minHeight: 64, flexWrap: "wrap", gap: 8, padding: "12px 16px" }}
      >
        <h2 style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" }}>{task.name}</h2>
        <div
          className="scheduled-task-editor__actions"
          style={{ flexWrap: "wrap", maxWidth: "100%" }}
        >
          <Button
            disabled={!canEdit || running || query.isFetching}
            variant="outline"
            onClick={() => {
              // 每次打开读取最新版本；取消后再开也必须能摆脱其他窗口写入前的旧缓存。
              void query.refetch({ cancelRefetch: false }).then((result) => {
                if (
                  !result.error &&
                  result.data?.canEdit &&
                  result.data.projectId === task.projectId
                )
                  setEditing(result.data);
              });
            }}
          >
            {labels.configure}
          </Button>
          {onEnabledChange ? (
            <Button
              variant="outline"
              disabled={running || (!task.enabled && (!canEdit || !view.config))}
              onClick={() => {
                onEnabledChange(task.id, !task.enabled);
              }}
            >
              {task.enabled ? labels.disable : labels.enable}
            </Button>
          ) : null}
          <Button
            disabled={!canEdit || !view.config || running}
            onClick={() => {
              if (runBusy.current) return;
              runBusy.current = true;
              setRunning(true);
              setError("");
              void onRunNow(task.id)
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : String(cause));
                })
                .finally(() => {
                  runBusy.current = false;
                  setRunning(false);
                });
            }}
          >
            {labels.run}
          </Button>
        </div>
      </div>
      <div className="scheduled-task-editor__body space-y-4">
        {query.error ? (
          <div role="alert">
            <p>{query.error.message}</p>
            <Button
              variant="ghost"
              onClick={() => {
                void query.refetch();
              }}
            >
              {labels.retry}
            </Button>
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {view && !canEdit ? <p role="status">{labels.blocked}</p> : null}
        {view && !view.config ? <p>{labels.first}</p> : null}
        <p>{task.projectName}</p>
        <p>
          {labels.next}: {format(task.nextRunAtUnixMs)}
        </p>
        <p className="whitespace-pre-wrap break-words">{task.prompt.text}</p>
        {attachments.map((attachment) => (
          <p key={attachment.id}>{attachment.name}</p>
        ))}
        <h3>{labels.history}</h3>
        {task.runs.length === 0 ? (
          <p>{labels.none}</p>
        ) : (
          task.runs.map((run) => (
            <div className="scheduled-task-run" key={run.id} data-status={run.status}>
              <time>{format(run.startedAtUnixMs)}</time>
              <span>{labels[run.status]}</span>
              {run.error ? <p className="text-danger">{run.error}</p> : null}
              {run.taskId ? (
                <Button
                  disabled={openingRun}
                  variant="ghost"
                  onClick={() => {
                    if (run.taskId) onOpenRun(task.projectId, run.taskId);
                  }}
                >
                  {labels.open}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>
      {editing ? (
        <AcpScheduledConfigDialog
          key={task.id}
          id={task.id}
          client={client}
          initial={editing}
          labels={labels}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={async (result) => {
            // 取消可能仍在途的旧读取，防止成功保存后被旧响应覆盖缓存。
            await queryClient.cancelQueries({ queryKey: key, exact: true });
            queryClient.setQueryData(key, result);
            setEditing(undefined);
          }}
        />
      ) : null}
    </section>
  );
}
