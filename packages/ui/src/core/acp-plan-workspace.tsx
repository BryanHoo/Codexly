import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { v4 as createUuid } from "uuid";
import type { AcpPlanPage, AcpPlanView } from "@codexly/protocol/acp-plan-api";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog.js";
import {
  planLabels,
  type AcpPlanUiClient,
  type AcpPlanScheduleField,
} from "./acp-plan-contract.js";
// 表单、配置控件和编辑会话只在用户打开计划后加载。
const AcpPlanEditor = lazy(() =>
  import("./acp-plan-editor.js").then((module) => ({ default: module.AcpPlanEditor })),
);
interface Props {
  client: AcpPlanUiClient;
  projectId: string;
  projects: readonly { id: string; name: string }[];
  language?: string;
  ScheduleField: AcpPlanScheduleField;
  children?: ReactNode;
}
/** 新私有计划与旧计划分开读取；显式打开历史入口才挂载旧查询，不为新列表读取全部正文。 */
export function AcpPlanWorkspace({
  client,
  projectId,
  projects,
  language,
  ScheduleField,
  children,
}: Props) {
  const l = language === "en" ? planLabels.en : planLabels["zh-CN"];
  const [page, setPage] = useState<AcpPlanPage>({ data: [], nextCursor: null });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<{ id: string; view?: AcpPlanView }>();
  const [removing, setRemoving] = useState<AcpPlanPage["data"][number]>();
  const [old, setOld] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const active = useRef(true);
  const lock = useRef(false);
  const load = useCallback(
    async (after?: string) => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      setPending(true);
      setError("");
      try {
        const result = await client.listAcpPlans(
          { limit: 100, ...(after === undefined ? {} : { after }) },
          { signal: request.signal },
        );
        if (active.current && !request.signal.aborted)
          setPage((current) =>
            after === undefined
              ? result
              : {
                  data: [
                    ...current.data,
                    ...result.data.filter(
                      (row) => !current.data.some((r) => r.scheduleId === row.scheduleId),
                    ),
                  ],
                  nextCursor: result.nextCursor,
                },
          );
      } catch (cause) {
        if (active.current && !request.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active.current && controller.current === request) setPending(false);
      }
    },
    [client],
  );
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, [load]);
  const edit = async (id: string) => {
    if (lock.current) return;
    lock.current = true;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setError("");
    try {
      const view = await client.readAcpPlan(id, { signal: request.signal });
      if (active.current && !request.signal.aborted) setEditor({ id, view });
    } catch (cause) {
      if (active.current && !request.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      if (active.current && !request.signal.aborted) setPending(false);
    }
  };
  const remove = async () => {
    if (!removing || lock.current) return;
    lock.current = true;
    setPending(true);
    const request = new AbortController();
    controller.current = request;
    try {
      await client.deleteAcpPlan(removing.scheduleId, removing.revision, {
        signal: request.signal,
        idempotencyKey: createUuid(),
      });
      if (active.current) {
        setRemoving(undefined);
        await load();
      }
    } catch (cause) {
      if (active.current && !request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setRemoving(undefined);
      }
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  };
  const names = new Map(projects.map((project) => [project.id, project.name]));
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-body font-semibold">{l.title}</h2>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            void load();
          }}
        >
          {l.refresh}
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            setEditor({ id: createUuid() });
          }}
        >
          {l.create}
        </Button>
      </header>
      {pending ? <p role="status">{l.loading}</p> : null}
      {error ? (
        <p role="alert" className="break-words text-destructive">
          {error}
        </p>
      ) : null}
      {!pending && !page.data.length ? (
        <p className="text-label text-muted-foreground">{l.empty}</p>
      ) : null}
      <div className="flex flex-col divide-y divide-separator">
        {page.data.map((row) => (
          <article key={row.scheduleId} className="flex min-w-0 flex-wrap items-center gap-2 py-3">
            <button
              type="button"
              disabled={pending}
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                void edit(row.scheduleId);
              }}
            >
              <span className="block break-words text-label font-medium">{row.name}</span>
              <span className="block break-words text-caption text-muted-foreground">
                {row.projectId === "temporary"
                  ? l.temporary
                  : (names.get(row.projectId) ?? row.projectId)}{" "}
                · {row.engine} ·{" "}
                {row.nextRunAt === null
                  ? l.ended
                  : new Date(row.nextRunAt).toLocaleString(language)}
              </span>
            </button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setRemoving(row);
              }}
            >
              {l.remove}
            </Button>
          </article>
        ))}
      </div>
      {page.nextCursor ? (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (page.nextCursor) void load(page.nextCursor);
          }}
        >
          {l.more}
        </Button>
      ) : null}
      {children ? (
        <>
          <Button
            variant="ghost"
            aria-expanded={old}
            onClick={() => {
              setOld((value) => !value);
            }}
          >
            {l.old}
          </Button>
          {old ? <div className="min-h-[30rem] border-t border-separator">{children}</div> : null}
        </>
      ) : null}
      {editor ? (
        <Suspense fallback={<p role="status">{l.loading}</p>}>
          <AcpPlanEditor
            key={editor.id}
            id={editor.id}
            {...(editor.view ? { view: editor.view } : {})}
            projectId={projectId}
            projects={projects}
            client={client}
            labels={l}
            ScheduleField={ScheduleField}
            onClose={() => {
              setEditor(undefined);
            }}
            onSaved={() => {
              void load();
            }}
          />
        </Suspense>
      ) : null}
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !pending) setRemoving(undefined);
        }}
      >
        <DialogContent closeLabel={l.close} closeDisabled={pending}>
          <DialogHeader>
            <DialogTitle>{l.removeTitle}</DialogTitle>
            <DialogDescription>{l.removeHint}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => {
                setRemoving(undefined);
              }}
            >
              {l.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                void remove();
              }}
            >
              {l.remove}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
