import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { v4 as createUuid } from "uuid";
import { CalendarClock, Plus, Search } from "lucide-react";
import { agentEngineName, TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { Input } from "./input.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { AcpPlanListRow } from "./acp-plan-list-row.js";
import type { AcpPlanEditorHandle } from "./acp-plan-editor.js";
import "./acp-plan-workspace.css";
import type { AcpPlanPage, AcpPlanView } from "@codexly/protocol/acp-plan-api";
import { Button } from "./button.js";
import type { OpenAcpPlanTask } from "./acp-plan-history.js";
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
  type AcpPlanPromptProps,
} from "./acp-plan-contract.js";
// 表单、配置控件和编辑会话只在用户打开计划后加载。
const AcpPlanEditor = lazy(() =>
  import("./acp-plan-editor.js").then((module) => ({ default: module.AcpPlanEditor })),
);
const AcpPlanHistory = lazy(() =>
  import("./acp-plan-history.js").then((module) => ({ default: module.AcpPlanHistory })),
);
const filters = ["all", "active", "inactive"] as const;

interface Props {
  client: AcpPlanUiClient;
  projectId: string;
  projects: readonly { id: string; name: string }[];
  language?: string;
  ScheduleField: AcpPlanScheduleField;
  preview: ComponentProps<AcpPlanScheduleField>["preview"];
  renderPrompt: (props: AcpPlanPromptProps) => ReactNode;
  onOpenTask: OpenAcpPlanTask;
  children?: ReactNode;
}
/** 新私有计划与旧计划分开读取；显式打开历史入口才挂载旧查询，不为新列表读取全部正文。 */
export function AcpPlanWorkspace({
  client,
  projectId,
  projects,
  language,
  ScheduleField,
  preview,
  renderPrompt,
  onOpenTask,
  children,
}: Props) {
  const l = language?.startsWith("en") ? planLabels.en : planLabels["zh-CN"];
  const [page, setPage] = useState<AcpPlanPage>({ data: [], nextCursor: null });
  const [listPending, setListPending] = useState(false);
  const [operationPending, setOperationPending] = useState(false);
  const pending = listPending || operationPending;
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<{ id: string; view?: AcpPlanView }>();
  const [removing, setRemoving] = useState<AcpPlanPage["data"][number]>();
  const [old, setOld] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const editorHandle = useRef<AcpPlanEditorHandle>(null);
  const [history, setHistory] = useState<{ id: string; name: string }>();
  const controller = useRef<AbortController | undefined>(undefined);
  const listController = useRef<AbortController | undefined>(undefined);
  const refreshQueued = useRef(false);
  const active = useRef(true);
  const lock = useRef(false);
  const load = useCallback(
    async function readList(after?: string, background = false): Promise<void> {
      if (background && listController.current) {
        refreshQueued.current = true;
        return;
      }
      // await 期间外部事件可能重新置位；读取函数获取最新的失效信号。
      const needsRefresh = () => refreshQueued.current;
      refreshQueued.current = false;
      listController.current?.abort();
      const request = new AbortController();
      listController.current = request;
      setListPending(true);
      setListError("");
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
          setListError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active.current && listController.current === request) {
          listController.current = undefined;
          setListPending(false);
          // 连续失效最多补读一次；不打断编辑加载，也不把列表数据写入草稿。
          if (needsRefresh()) void readList(undefined, true);
        }
      }
    },
    [client],
  );
  useEffect(() => {
    active.current = true;
    const unsubscribe = client.subscribeAcpPlans(() => {
      void load(undefined, true);
    });
    void load(undefined, true);
    return () => {
      active.current = false;
      listController.current?.abort();
      listController.current = undefined;
      refreshQueued.current = false;
      controller.current?.abort();
      unsubscribe();
    };
  }, [client, load]);
  const edit = async (id: string) => {
    if (lock.current) return;
    lock.current = true;
    // 离开确认通过后卸载旧详情，防止新详情加载期间继续修改即将替换的草稿。
    setEditor(undefined);
    setHistory(undefined);
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setOperationPending(true);
    setError("");
    try {
      const view = await client.readAcpPlan(id, { signal: request.signal });
      if (active.current && !request.signal.aborted) {
        setEditor({ id, view });
      }
    } catch (cause) {
      if (active.current && !request.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      if (active.current && !request.signal.aborted) setOperationPending(false);
    }
  };
  const remove = async () => {
    if (!removing || lock.current) return;
    lock.current = true;
    setOperationPending(true);
    const request = new AbortController();
    controller.current = request;
    try {
      await client.deleteAcpPlan(removing.scheduleId, removing.revision, {
        signal: request.signal,
        idempotencyKey: createUuid(),
      });
      if (active.current) {
        setRemoving(undefined);
        if (editor?.id === removing.scheduleId) setEditor(undefined);
        if (history?.id === removing.scheduleId) setHistory(undefined);
        await load();
      }
    } catch (cause) {
      if (active.current && !request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setRemoving(undefined);
      }
    } finally {
      lock.current = false;
      if (active.current) setOperationPending(false);
    }
  };
  const names = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const projectName = (id: string) =>
    id === TEMPORARY_TASK_SCOPE_ID ? l.temporary : (names.get(id) ?? id);
  const term = search.trim().toLocaleLowerCase();
  const rows = page.data.filter(
    (row) =>
      (filter === "all" || row.enabled === (filter === "active")) &&
      (!term ||
        `${row.name} ${projectName(row.projectId)} ${agentEngineName(row.engine)}`
          .toLocaleLowerCase()
          .includes(term)),
  );
  // 列表切换、查看历史和旧计划入口统一交给右栏处理草稿取舍。
  const leaveEditor = (next: () => void) => {
    if (editorHandle.current) editorHandle.current.leave(next);
    else next();
  };
  const showHistory = (id: string, name: string) => {
    leaveEditor(() => {
      setEditor(undefined);
      setHistory({ id, name });
    });
  };

  const selectedView = editor?.view;
  if (old && children) {
    return (
      <div className="acp-plan-legacy">
        <div className="scheduled-task-editor__toolbar">
          <Button
            variant="outline"
            onClick={() => {
              setOld(false);
            }}
          >
            {l.back}
          </Button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <section className="scheduled-tasks acp-plan-workspace" aria-label={l.title}>
      <aside className="scheduled-task-list">
        <div className="scheduled-task-list__header">
          <div>
            <h2>{l.title}</h2>
            <span>{page.data.length}</span>
          </div>
          <Button
            aria-label={l.create}
            size="icon-toolbar"
            disabled={operationPending}
            onClick={() => {
              leaveEditor(() => {
                setHistory(undefined);
                setEditor({ id: createUuid() });
              });
            }}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        <div className="scheduled-task-filters" role="group" aria-label={l.filter}>
          {filters.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
              }}
            >
              {l[value]}
            </button>
          ))}
        </div>
        <div className="scheduled-task-search">
          <Search aria-hidden="true" />
          <Input
            type="search"
            aria-label={l.search}
            placeholder={l.search}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
            }}
          />
        </div>
        <div className="scheduled-task-list__items">
          {error || listError ? (
            <p role="alert" className="break-words px-2 text-destructive">
              {error || listError}
            </p>
          ) : null}
          {listPending && page.data.length === 0 ? <LoadingSkeleton label={l.loading} /> : null}
          {!listPending && !listError && rows.length === 0 ? (
            <div className="scheduled-task-list__empty">
              <CalendarClock aria-hidden="true" />
              <span>{term || filter !== "all" ? l.noMatches : l.empty}</span>
            </div>
          ) : null}
          {rows.map((row) => (
            <AcpPlanListRow
              key={row.scheduleId}
              row={row}
              selected={row.scheduleId === (editor?.id ?? history?.id)}
              disabled={operationPending}
              projectName={projectName(row.projectId)}
              language={language}
              labels={l}
              onEdit={() => {
                if (editor?.id !== row.scheduleId)
                  leaveEditor(() => {
                    void edit(row.scheduleId);
                  });
              }}
              onHistory={() => {
                showHistory(row.scheduleId, row.name);
              }}
              onRemove={() => {
                if (editor?.id === row.scheduleId)
                  leaveEditor(() => {
                    setRemoving(row);
                  });
                else setRemoving(row);
              }}
            />
          ))}
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
        </div>
        <div className="acp-plan-list-actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              void load();
            }}
          >
            {l.refresh}
          </Button>
          {children ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={operationPending}
              onClick={() => {
                leaveEditor(() => {
                  setEditor(undefined);
                  setHistory(undefined);
                  setOld(true);
                });
              }}
            >
              {l.old}
            </Button>
          ) : null}
        </div>
      </aside>
      <Suspense
        fallback={
          <div className="scheduled-task-welcome" role="status">
            {l.loading}
          </div>
        }
      >
        {editor ? (
          <AcpPlanEditor
            key={editor.id}
            ref={editorHandle}
            id={editor.id}
            {...(selectedView
              ? {
                  view: selectedView,
                  runHistory: (
                    <AcpPlanHistory
                      client={client}
                      id={editor.id}
                      name={selectedView.definition.name}
                      labels={l}
                      {...(language === undefined ? {} : { language })}
                      onOpenTask={onOpenTask}
                    />
                  ),
                }
              : {})}
            projectId={projectId}
            projects={projects}
            client={client}
            labels={l}
            ScheduleField={ScheduleField}
            preview={preview}
            renderPrompt={renderPrompt}
            onClose={() => {
              setEditor(undefined);
            }}
            onSaved={(view) => {
              setEditor({ id: editor.id, view });
              void load(undefined, true);
            }}
          />
        ) : history ? (
          <AcpPlanHistory
            key={history.id}
            client={client}
            id={history.id}
            name={history.name}
            labels={l}
            {...(language === undefined ? {} : { language })}
            onOpenTask={onOpenTask}
            onClose={() => {
              setHistory(undefined);
            }}
          />
        ) : operationPending ? (
          <div className="scheduled-task-welcome" role="status">
            {l.loading}
          </div>
        ) : (
          <div className="scheduled-task-welcome">
            <CalendarClock aria-hidden="true" />
            <h2>{l.welcome}</h2>
            <p>{l.welcomeHint}</p>
          </div>
        )}
      </Suspense>
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
