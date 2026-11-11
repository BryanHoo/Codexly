import { useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { v4 as createUuid } from "uuid";
import type {
  AcpConfigPreview,
  AcpConfigPreviewRequest,
  AcpScheduledConfigView,
  AgentEngine,
} from "@codexly/protocol";
import { AcpConfigOptions } from "./acp-config-options.js";
import { Button } from "./button.js";
import { Checkbox } from "./checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";
import type {
  AcpScheduledConfigClient,
  ScheduledConfigLabels,
} from "./acp-scheduled-config-contract.js";

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-label">{label}</div>
      {description ? <p className="text-body-small text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  );
}
function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className="h-9 w-full rounded-md border bg-control px-2 text-label" />;
}

/** 预览只作用于草稿；保存携带打开时的版本，不能覆盖其他页面刚提交的配置。 */
export function AcpScheduledConfigDialog({
  client,
  id,
  initial,
  labels,
  onClose,
  onSaved,
}: Readonly<{
  client: AcpScheduledConfigClient;
  id: string;
  initial: AcpScheduledConfigView;
  labels: ScheduledConfigLabels;
  onClose: () => void;
  onSaved: (view: AcpScheduledConfigView) => void | Promise<void>;
}>) {
  const [engine, setEngine] = useState<AgentEngine | "">(initial.config?.engine ?? "");
  const [preview, setPreview] = useState<AcpConfigPreview>();
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const active = useRef(true);
  const controller = useRef<AbortController | undefined>(undefined);
  const busy = useRef(false);
  const previewBusy = useRef(false);
  const attempt = useRef<{ signature: string; key: string } | undefined>(undefined);
  const lastPreview = useRef<{ engine: AgentEngine; input: AcpConfigPreviewRequest } | undefined>(
    undefined,
  );
  const load = async (selected: AgentEngine, input: AcpConfigPreviewRequest) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    lastPreview.current = { engine: selected, input };
    previewBusy.current = true;
    setPreviewFailed(false);
    setPending(true);
    setError("");
    try {
      const result = await client.previewAcpConfig(initial.projectId, selected, input, {
        signal: request.signal,
      });
      // 关闭、切换引擎及后发预览都会使旧响应失效，即使底层未及时停止请求也不能污染草稿。
      if (active.current && controller.current === request && !request.signal.aborted)
        setPreview(result);
    } catch (cause) {
      if (active.current && controller.current === request && !request.signal.aborted) {
        setPreviewFailed(true);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (active.current && controller.current === request) {
        previewBusy.current = false;
        setPending(false);
      }
    }
  };
  useEffect(() => {
    active.current = true;
    if (initial.config) void load(initial.config.engine, { values: initial.config.values });
    return () => {
      active.current = false;
      controller.current?.abort();
    };
    // 弹窗按计划身份挂载，initial 是打开时的不可变快照，后台刷新不能重置未保存草稿。
  }, []);
  const close = () => {
    if (busy.current) return;
    if (dirty) setDiscarding(true);
    else onClose();
  };
  const save = async () => {
    if (
      busy.current ||
      previewBusy.current ||
      !engine ||
      !preview ||
      previewFailed ||
      (!initial.config && !confirmed)
    )
      return;
    const input = {
      projectId: initial.projectId,
      engine,
      values: preview.values,
      expectedRevision: initial.config?.revision ?? 0,
      ...(!initial.config ? { confirmMigration: true } : {}),
    };
    const signature = JSON.stringify(input);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: createUuid() };
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await client.setAcpScheduledConfig(id, input, {
        idempotencyKey: attempt.current.key,
      });
      if (active.current) await onSaved(result);
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  };
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent closeLabel={labels.cancel} closeDisabled={saving} className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{labels.configure}</DialogTitle>
            <DialogDescription>
              {initial.config ? labels.configure : labels.first}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-auto">
            <Field label={labels.agent}>
              <Select
                aria-label={labels.agent}
                value={engine}
                disabled={saving || pending}
                onChange={(event) => {
                  const selected = event.currentTarget.value;
                  if (selected !== "codex" && selected !== "claude") return;
                  setEngine(selected);
                  setDirty(true);
                  setConfirmed(false);
                  setPreview(undefined);
                  void load(selected, { values: {} });
                }}
              >
                <option value="" disabled>
                  {labels.choose}
                </option>
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </Select>
            </Field>
            {pending ? <p role="status">{labels.preview}</p> : null}
            {preview ? (
              <AcpConfigOptions
                Field={Field}
                Select={Select}
                options={preview.configOptions}
                disabled={saving || pending}
                onChange={(configId, value) => {
                  if (!engine || pending || busy.current) return;
                  setDirty(true);
                  void load(engine, { values: preview.values, change: { configId, value } });
                }}
              />
            ) : null}
            {preview?.configOptions.length === 0 ? <p>{labels.empty}</p> : null}
            {!initial.config ? (
              <label className="flex items-center gap-2 text-label">
                <Checkbox
                  aria-label={labels.confirm}
                  disabled={saving || pending || !preview}
                  checked={confirmed}
                  onCheckedChange={(value) => {
                    setConfirmed(value === true);
                  }}
                />
                {labels.confirm}
              </label>
            ) : null}
            {error ? (
              <div role="alert" className="space-y-2 text-danger">
                <p>{error}</p>
                {previewFailed && lastPreview.current ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const last = lastPreview.current;
                      if (last) void load(last.engine, last.input);
                    }}
                  >
                    {labels.retry}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={saving} onClick={close}>
              {labels.cancel}
            </Button>
            <Button
              disabled={
                saving ||
                pending ||
                previewFailed ||
                !preview ||
                !engine ||
                (!initial.config && !confirmed)
              }
              onClick={() => {
                void save();
              }}
            >
              {labels.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {discarding ? (
        <Dialog open onOpenChange={setDiscarding}>
          <DialogContent closeLabel={labels.keep}>
            <DialogHeader>
              <DialogTitle>{labels.discardTitle}</DialogTitle>
              <DialogDescription>{labels.discardDescription}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setDiscarding(false);
                }}
              >
                {labels.keep}
              </Button>
              <Button variant="destructive" onClick={onClose}>
                {labels.discard}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
