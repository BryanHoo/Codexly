import { v4 as createUuid } from "uuid";
import { useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import type {
  AcpConfigPreview,
  AcpConfigPreviewRequest,
  AgentEngine,
  ScheduledTaskSchedule,
} from "@codexly/protocol";
import type { AcpPlanView } from "@codexly/protocol/acp-plan-api";
import { AcpPlanEditorSession } from "@codexly/frontend-core/acp-plan-editor";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Checkbox } from "./checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog.js";
import { AcpConfigOptions } from "./acp-config-options.js";
import type { AcpPlanUiClient, AcpPlanScheduleField, PlanLabels } from "./acp-plan-contract.js";
const Field = ({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) => (
  <label className="flex min-w-0 flex-col gap-1 text-label">
    <span className="break-words">{label}</span>
    {children}
    {description ? <span className="text-caption text-muted-foreground">{description}</span> : null}
  </label>
);
const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    {...props}
    className="h-9 w-full min-w-0 rounded-control border border-separator bg-panel px-2 text-label"
  />
);
export interface AcpPlanEditorProps {
  id: string;
  projectId: string;
  view?: AcpPlanView;
  client: AcpPlanUiClient;
  projects: readonly { id: string; name: string }[];
  labels: PlanLabels;
  ScheduleField: AcpPlanScheduleField;
  onClose: () => void;
  onSaved: (view: AcpPlanView) => void;
}
/** 配置、资源和提交共用会话；弹窗按计划身份挂载，后台列表刷新不会替换草稿。 */
export function AcpPlanEditor(props: AcpPlanEditorProps) {
  const { client, labels: l, ScheduleField } = props;
  const [session] = useState(() =>
    props.view
      ? AcpPlanEditorSession.edit(props.view, client, () => createUuid())
      : new AcpPlanEditorSession(
          props.id,
          {
            name: "",
            projectId: props.projectId,
            engine: "codex",
            values: {},
            enabled: false,
            prompt: { type: "prompt", text: "", attachments: [], skills: [] },
            schedule: { type: "once", atUnixMs: Date.now() + 3600000 },
          },
          client,
          () => createUuid(),
        ),
  );
  const [state, setState] = useState(() => session.snapshot);
  const [engine, setEngine] = useState<AgentEngine | "">(props.view?.definition.engine ?? "");
  const [preview, setPreview] = useState<AcpConfigPreview>();
  const [pending, setPending] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [validSchedule, setValidSchedule] = useState(true);
  const [scheduleGeneration, setScheduleGeneration] = useState(0);
  const [confirm, setConfirm] = useState<"close" | "reload">();
  const active = useRef(true);
  const request = useRef<AbortController | undefined>(undefined);
  const lock = useRef(false);
  useEffect(() => {
    active.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session.snapshot.dirty) {
        event.preventDefault();
        // oxlint-disable-next-line typescript/no-deprecated -- 兼容项目最低 Chromium 116 的离页确认。
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      active.current = false;
      request.current?.abort();
      // StrictMode 会重放 effect；延后关闭以保留重放会话，真实卸载仍会取消。
      queueMicrotask(() => {
        if (!active.current) session.close();
      });
    };
  }, [session]);
  const sync = () => {
    if (active.current) setState(session.snapshot);
  };
  const patch = (value: Partial<typeof state.definition>) => {
    session.update({ ...session.snapshot.definition, ...value });
    setSaved(false);
    sync();
  };
  const fail = (cause: unknown) => {
    if (active.current) setError(cause instanceof Error ? cause.message : String(cause));
  };
  const busy = state.busy || pending || working;
  const blocked = state.view?.canEdit === false;
  const load = async (selected: AgentEngine, input: AcpConfigPreviewRequest) => {
    if (lock.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError("");
    try {
      const result = await client.previewAcpConfig(
        session.snapshot.definition.projectId,
        selected,
        input,
        { signal: controller.signal },
      );
      if (active.current && request.current === controller && !controller.signal.aborted) {
        setPreview(result);
        patch({ values: result.values });
      }
    } catch (cause) {
      if (!controller.signal.aborted) fail(cause);
    } finally {
      if (active.current && request.current === controller) setPending(false);
    }
  };
  const action = async (fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setError("");
    setSaved(false);
    try {
      const pending = fn();
      sync();
      await pending;
      sync();
    } catch (cause) {
      fail(cause);
    } finally {
      lock.current = false;
      if (active.current) setWorking(false);
      sync();
    }
  };
  const close = () => {
    if (lock.current) return;
    if (session.snapshot.dirty) setConfirm("close");
    else props.onClose();
  };
  const reload = async () => {
    if (lock.current) return;
    lock.current = true;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setPending(true);
    try {
      const view = await client.readAcpPlan(props.id, { signal: controller.signal });
      if (active.current && !controller.signal.aborted) {
        session.load(view);
        // 明确重读必须重置日历本地草稿，即使服务端规则与上次读取相同。
        setScheduleGeneration((value) => value + 1);
        setEngine(view.definition.engine);
        setPreview(undefined);
        setValidSchedule(true);
        setError("");
        sync();
      }
    } catch (cause) {
      if (!controller.signal.aborted) fail(cause);
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  };
  const submit = () =>
    action(async () => {
      const view = await session.save();
      if (view && active.current) {
        setSaved(true);
        props.onSaved(view);
      }
    });
  const upload = async (file: File) =>
    action(async () => {
      const controller = new AbortController();
      request.current = controller;
      const kind = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)
        ? "image"
        : "file";
      const result = await client.uploadAttachment(
        session.snapshot.definition.projectId,
        { kind, name: file.name, content: file },
        { signal: controller.signal },
      );
      if (active.current && !controller.signal.aborted) await session.stage(result.attachment);
    });
  const configReady =
    !!preview ||
    (state.view?.definition.enabled &&
      state.view.definition.engine === engine &&
      JSON.stringify(state.view.definition.values) === JSON.stringify(state.definition.values));
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          closeLabel={l.close}
          closeDisabled={state.busy || working}
          className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle>{state.view ? l.edit : l.create}</DialogTitle>
            <DialogDescription className="break-words">
              {state.definition.name || l.title}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (
                !busy &&
                !blocked &&
                engine &&
                validSchedule &&
                (!state.definition.enabled || configReady)
              )
                void submit();
            }}
          >
            {blocked ? <p role="status">{l.blocked}</p> : null}
            <fieldset disabled={busy || blocked} className="flex min-w-0 flex-col gap-4">
              <Field label={l.name}>
                <Input
                  aria-label={l.name}
                  maxLength={120}
                  value={state.definition.name}
                  onChange={(e) => {
                    patch({ name: e.currentTarget.value });
                  }}
                />
              </Field>
              <Field label={l.project}>
                <Select
                  aria-label={l.project}
                  disabled={!!state.view || state.resources.length > 0}
                  value={state.definition.projectId}
                  onChange={(e) => {
                    setPreview(undefined);
                    patch({ projectId: e.currentTarget.value });
                  }}
                >
                  <option value="temporary">{l.temporary}</option>
                  {!props.projects.some((p) => p.id === state.definition.projectId) &&
                  state.definition.projectId !== "temporary" ? (
                    <option value={state.definition.projectId}>{state.definition.projectId}</option>
                  ) : null}
                  {props.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={l.agent}>
                <Select
                  aria-label={l.agent}
                  value={engine}
                  onChange={(e) => {
                    const next = e.currentTarget.value as AgentEngine;
                    setEngine(next);
                    setPreview(undefined);
                    patch({ engine: next, values: {} });
                    void load(next, { values: {} });
                  }}
                >
                  <option value="" disabled>
                    {l.choose}
                  </option>
                  <option value="codex">Codex</option>
                  <option value="claude">Claude</option>
                </Select>
              </Field>
              <Button
                type="button"
                disabled={!engine}
                onClick={() => {
                  if (engine) void load(engine, { values: state.definition.values });
                }}
              >
                {l.preview}
              </Button>
              {preview ? (
                <AcpConfigOptions
                  options={preview.configOptions}
                  Field={Field}
                  Select={Select}
                  onChange={(id, value) => {
                    if (engine)
                      void load(engine, {
                        values: state.definition.values,
                        change: { configId: id, value },
                      });
                  }}
                />
              ) : state.view ? (
                <p className="text-caption text-muted-foreground">{l.settingsSaved}</p>
              ) : null}
              <Field label={l.prompt}>
                <textarea
                  aria-label={l.prompt}
                  maxLength={100000}
                  rows={6}
                  className="w-full resize-y rounded-control border border-separator bg-panel p-2 text-body"
                  value={state.definition.prompt.text}
                  onChange={(e) => {
                    patch({ prompt: { ...state.definition.prompt, text: e.currentTarget.value } });
                  }}
                />
              </Field>
              <div className="flex flex-col gap-2">
                <label className="text-label">
                  {l.attach}
                  <input
                    aria-label={l.attach}
                    type="file"
                    className="mt-1 block max-w-full text-caption"
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      e.currentTarget.value = "";
                      if (file) void upload(file);
                    }}
                  />
                </label>
                {state.resources.map((r) => (
                  <div key={r.token} className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 break-words text-caption">
                      {r.attachment.name}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`${l.removeAttachment}: ${r.attachment.name}`}
                      onClick={() => {
                        session.removeAttachment(r.attachment.id);
                        sync();
                      }}
                    >
                      {l.removeAttachment}
                    </Button>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-2 text-label">{l.schedule}</div>
                <ScheduleField
                  key={`${String(scheduleGeneration)}:${JSON.stringify(state.view?.definition.schedule ?? null)}`}
                  value={state.definition.schedule}
                  disabled={busy || blocked}
                  onChange={(value: ScheduledTaskSchedule | undefined) => {
                    setValidSchedule(!!value);
                    if (value) patch({ schedule: value });
                  }}
                />
                {!validSchedule ? <p role="alert">{l.invalidSchedule}</p> : null}
              </div>
              <label className="flex items-center gap-2 text-label">
                <Checkbox
                  aria-label={l.enabled}
                  checked={state.definition.enabled}
                  onCheckedChange={(value) => {
                    if (typeof value === "boolean") patch({ enabled: value });
                  }}
                />
                {l.enabled}
              </label>
            </fieldset>
            {pending ? <p role="status">{l.loading}</p> : null}
            {state.definition.enabled && !configReady ? <p>{l.previewNeeded}</p> : null}
            {error ? (
              <p role="alert" className="break-words text-destructive">
                {error}
              </p>
            ) : null}
            {saved ? <p role="status">{l.saved}</p> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={state.busy || working}
                onClick={close}
              >
                {l.cancel}
              </Button>
              {state.view || error ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (state.dirty) setConfirm("reload");
                    else void reload();
                  }}
                >
                  {l.reload}
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={
                  busy ||
                  blocked ||
                  !engine ||
                  !validSchedule ||
                  !state.definition.name.trim() ||
                  (state.definition.enabled && !configReady)
                }
              >
                {l.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(undefined);
        }}
      >
        <DialogContent closeLabel={l.close}>
          <DialogHeader>
            <DialogTitle>{confirm === "reload" ? l.reloadTitle : l.discardTitle}</DialogTitle>
            <DialogDescription>{l.discardHint}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                setConfirm(undefined);
              }}
            >
              {l.keep}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const next = confirm;
                setConfirm(undefined);
                if (next === "reload") void reload();
                else props.onClose();
              }}
            >
              {l.discard}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
