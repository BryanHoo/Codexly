import { v4 as createUuid } from "uuid";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type ComponentProps,
} from "react";
import { TEMPORARY_TASK_SCOPE_ID, type ScheduledTaskSchedule } from "@codexly/protocol";
import { CalendarClock, Play, Save, SlidersHorizontal } from "lucide-react";
import type { AcpPlanView, RunAcpPlan } from "@codexly/protocol/acp-plan-api";
import { AcpPlanEditorSession } from "@codexly/frontend-core/acp-plan-editor";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Checkbox } from "./checkbox.js";
import { toast } from "./notifications.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog.js";
import type {
  AcpPlanUiClient,
  AcpPlanScheduleField,
  AcpPlanPromptHandle,
  AcpPlanPromptProps,
  PlanLabels,
} from "./acp-plan-contract.js";

export interface AcpPlanEditorHandle {
  leave: (next: () => void) => void;
}

export interface AcpPlanEditorProps {
  ref?: Ref<AcpPlanEditorHandle>;
  id: string;
  projectId: string;
  view?: AcpPlanView;
  client: AcpPlanUiClient;
  projects: readonly { id: string; name: string }[];
  labels: PlanLabels;
  ScheduleField: AcpPlanScheduleField;
  onClose: () => void;
  runHistory?: ReactNode;
  preview: ComponentProps<AcpPlanScheduleField>["preview"];
  renderPrompt: (props: AcpPlanPromptProps) => ReactNode;
  onSaved: (view: AcpPlanView) => void;
}
/** 配置、资源和提交共用会话；右栏按计划身份挂载，后台列表刷新不会替换草稿。 */
export function AcpPlanEditor(props: AcpPlanEditorProps) {
  const { client, labels: l, ScheduleField, renderPrompt } = props;
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
  const [promptSeed, setPromptSeed] = useState(() => ({
    prompt: state.definition.prompt,
    attachments: state.resources.map((resource) => resource.attachment),
    initialConfig: {
      ...(props.view ? { engine: props.view.definition.engine } : {}),
      values: state.definition.values,
    },
  }));
  const composer = useRef<AcpPlanPromptHandle>(null);
  const manualRequest = useRef<RunAcpPlan | undefined>(undefined);
  const stagedIds = useRef(new Map<string, string>());
  const [hasInput, setHasInput] = useState(false);
  const [pending, setPending] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [validSchedule, setValidSchedule] = useState(true);
  const [scheduleGeneration, setScheduleGeneration] = useState(0);
  const [promptGeneration, setPromptGeneration] = useState(0);
  const [confirm, setConfirm] = useState<{ kind: "close" | "reload"; proceed: () => void }>();
  const active = useRef(true);
  const request = useRef<AbortController | undefined>(undefined);
  const lock = useRef(false);
  useEffect(() => {
    active.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session.snapshot.dirty || composer.current?.hasDraftChanges?.()) {
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
    sync();
  };
  const fail = (cause: unknown) => {
    if (active.current) setError(cause instanceof Error ? cause.message : String(cause));
  };
  const busy = state.busy || pending || working;
  const blocked = state.view?.canEdit === false;
  const dirty = () =>
    session.snapshot.dirty || !validSchedule || composer.current?.hasDraftChanges?.() === true;
  // 离开右栏前统一确认未保存修改，切换计划与关闭按钮共用同一处保护。
  const leave = (next: () => void) => {
    if (lock.current || working || confirm) return;
    if (dirty()) setConfirm({ kind: "close", proceed: next });
    else next();
  };
  useImperativeHandle(props.ref, () => ({ leave }));
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
        setPromptGeneration((value) => value + 1);
        manualRequest.current = undefined;
        stagedIds.current.clear();
        setPromptSeed({
          prompt: view.definition.prompt,
          attachments: view.resources.map((resource) => resource.attachment),
          initialConfig: { engine: view.definition.engine, values: view.definition.values },
        });
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
  const runNow = async () => {
    if (lock.current || working || !state.view) return;
    lock.current = true;
    setPending(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const current = await client.readAcpPlan(props.id, { signal: controller.signal });
      if (current.revision !== state.view.revision || !current.state)
        throw new Error(l.reloadTitle);
      const input = manualRequest.current ?? {
        expectedRevision: current.revision,
        expectedStateRevision: current.state.revision,
        runId: createUuid(),
      };
      manualRequest.current = input;
      await client.runAcpPlan(props.id, input, {
        signal: controller.signal,
        idempotencyKey: input.runId,
      });
      manualRequest.current = undefined;
    } catch (cause) {
      if (!controller.signal.aborted) fail(cause);
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  };
  const capture: AcpPlanPromptProps["onCapture"] = async (input, attachments, engine, values) => {
    if (lock.current || blocked) return;
    // 输入框的键盘提交也走同一校验，不能绕过右栏保存按钮的状态。
    if (!state.definition.name.trim() || !validSchedule) {
      const cause = new Error(!validSchedule ? l.invalidSchedule : l.name);
      fail(cause);
      throw cause;
    }
    lock.current = true;
    setError("");
    try {
      // 中栏负责上传，计划事务负责私有化；重试复用已暂存的资源，避免重复复制附件。
      const ids = new Set(session.snapshot.resources.map((resource) => resource.attachment.id));
      const keep = new Set<string>();
      for (const attachment of attachments) {
        const mapped = stagedIds.current.get(attachment.id) ?? attachment.id;
        if (ids.has(mapped)) {
          keep.add(mapped);
          continue;
        }
        await session.stage(attachment);
        if (!active.current) return;
        const resource = session.snapshot.resources.at(-1);
        if (!resource) return;
        stagedIds.current.set(attachment.id, resource.attachment.id);
        keep.add(resource.attachment.id);
      }
      for (const id of ids) {
        if (!keep.has(id)) session.removeAttachment(id);
      }
      const definition = session.snapshot.definition;
      session.update({
        ...definition,
        engine,
        values,
        prompt: { ...input, attachments: definition.prompt.attachments },
      });
      const view = await session.save();
      if (view && active.current) {
        // 保存成功后以服务端私有资源快照重新建立输入基线，后续切换不误报草稿。
        manualRequest.current = undefined;
        stagedIds.current.clear();
        setPromptSeed({
          prompt: view.definition.prompt,
          attachments: view.resources.map((resource) => resource.attachment),
          initialConfig: { engine: view.definition.engine, values: view.definition.values },
        });
        setPromptGeneration((value) => value + 1);
        props.onSaved(view);
        toast.success(l.saved);
      }
    } catch (cause) {
      fail(cause);
      throw cause;
    } finally {
      lock.current = false;
      sync();
    }
  };
  return (
    <>
      <section aria-label={state.view ? l.edit : l.create} className="scheduled-task-editor">
        <div className="scheduled-task-editor__toolbar">
          <span className="scheduled-task-status" data-enabled={state.definition.enabled}>
            <span aria-hidden="true" />
            {state.view ? (state.view.definition.enabled ? l.active : l.inactive) : l.create}
          </span>
          <div className="scheduled-task-editor__actions">
            {state.view ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  blocked ||
                  !state.view.state ||
                  (!state.view.definition.prompt.text.trim() &&
                    !state.view.definition.prompt.attachments.length)
                }
                onClick={() => {
                  void runNow();
                }}
              >
                <Play aria-hidden="true" />
                {l.runNow}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                leave(props.onClose);
              }}
            >
              {l.cancel}
            </Button>
            {state.view || error ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (dirty())
                    setConfirm({
                      kind: "reload",
                      proceed: () => {
                        void reload();
                      },
                    });
                  else void reload();
                }}
              >
                {l.reload}
              </Button>
            ) : null}
            <Button
              size="sm"
              type="button"
              onClick={() => {
                void composer.current?.submitCurrent();
              }}
              disabled={
                busy || blocked || !hasInput || !validSchedule || !state.definition.name.trim()
              }
            >
              <Save aria-hidden="true" />
              {l.save}
            </Button>
          </div>
        </div>
        <div className="scheduled-task-editor__body">
          {blocked ? <p role="status">{l.blocked}</p> : null}
          <label className="scheduled-task-title">
            <Input
              aria-label={l.name}
              placeholder={l.name}
              maxLength={120}
              value={state.definition.name}
              disabled={busy || blocked}
              onChange={(event) => {
                patch({ name: event.currentTarget.value });
              }}
            />
          </label>
          <div className="scheduled-task-prompt">
            <h3>{l.prompt}</h3>
            <fieldset disabled={pending || blocked}>
              {renderPrompt({
                ...promptSeed,
                composerRef: composer,
                id: `${props.id}:${String(promptGeneration)}`,
                projectId: state.definition.projectId,
                onCapture: capture,
                onInputStateChange: setHasInput,
                onSubmissionStateChange: setWorking,
              })}
            </fieldset>
          </div>
          <fieldset disabled={busy || blocked}>
            <section className="scheduled-task-section">
              <h3>
                <SlidersHorizontal aria-hidden="true" />
                {l.details}
              </h3>
              <div className="scheduled-task-fields">
                <label>
                  <span>{l.project}</span>
                  <select
                    aria-label={l.project}
                    disabled={!!state.view || state.resources.length > 0 || hasInput}
                    value={state.definition.projectId}
                    onChange={(event) => {
                      patch({ projectId: event.currentTarget.value });
                    }}
                  >
                    <option value={TEMPORARY_TASK_SCOPE_ID}>{l.temporary}</option>
                    {!props.projects.some((project) => project.id === state.definition.projectId) &&
                    state.definition.projectId !== TEMPORARY_TASK_SCOPE_ID ? (
                      <option value={state.definition.projectId}>
                        {state.definition.projectId}
                      </option>
                    ) : null}
                    {props.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="scheduled-task-info">
                  <span>{l.runIn}</span>
                  <span>{l.newChat}</span>
                </div>
                <div className="scheduled-task-info">
                  <span>{l.enabled}</span>
                  <Checkbox
                    aria-label={l.enabled}
                    checked={state.definition.enabled}
                    onCheckedChange={(value) => {
                      if (typeof value === "boolean") patch({ enabled: value });
                    }}
                  />
                </div>
              </div>
            </section>
            <section className="scheduled-task-section">
              <h3>
                <CalendarClock aria-hidden="true" />
                {l.schedule}
              </h3>
              <ScheduleField
                key={`${String(scheduleGeneration)}:${JSON.stringify(state.view?.definition.schedule ?? null)}`}
                value={state.definition.schedule}
                preview={props.preview}
                disabled={busy || blocked}
                onChange={(value: ScheduledTaskSchedule | undefined) => {
                  setValidSchedule(!!value);
                  if (value) patch({ schedule: value });
                }}
              />
              {!validSchedule ? <p role="alert">{l.invalidSchedule}</p> : null}
            </section>
          </fieldset>
          {props.runHistory}
          {pending ? <p role="status">{l.loading}</p> : null}
          {error ? (
            <p role="alert" className="break-words text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </section>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(undefined);
        }}
      >
        <DialogContent closeLabel={l.close}>
          <DialogHeader>
            <DialogTitle>{confirm?.kind === "reload" ? l.reloadTitle : l.discardTitle}</DialogTitle>
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
                setConfirm(undefined);
                confirm?.proceed();
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
