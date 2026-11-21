import { useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  MAX_ACP_GLOBAL_INSTRUCTIONS_LENGTH,
  type AgentInstructionsTargets,
  type ApplicationPreferences,
  type SaveAgentInstructions,
} from "@codexly/protocol/application-preferences";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";
import { Button } from "./button.js";

/** 两种引擎共用全宽指令编辑区；读取、冲突处理和保存由各自页面管理。 */
export function PersonalizationInstructionsEditor({
  id,
  label,
  description,
  beforeEditor,
  children,
  ...inputProps
}: Readonly<{
  id: string;
  label: string;
  description: ReactNode;
  beforeEditor?: ReactNode;
  children?: ReactNode;
}> &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "children" | "className">) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label className="text-body font-semibold" htmlFor={id}>
            {label}
          </label>
          <p id={`${id}-description`} className="mt-1 text-body-small text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {beforeEditor}
      <textarea
        {...inputProps}
        id={id}
        aria-describedby={`${id}-description`}
        className="min-h-56 w-full resize-y rounded-control border border-separator bg-panel p-3 text-body-small focus:shadow-focus focus:outline-none"
        spellCheck={false}
      />
      {children}
    </div>
  );
}

interface AgentInstructionsClient {
  getAgentInstructionsTargets?: () => Promise<AgentInstructionsTargets>;
  saveAgentInstructions?: (input: SaveAgentInstructions) => Promise<ApplicationPreferences>;
}

/** 草稿仅属于编辑器。只有确认对话框的提交动作能写入应用偏好和 Agent 文件。 */
export function AcpGlobalInstructionsSettings({
  language,
  label,
  content,
  failed,
  onRetry,
  client,
}: Readonly<{
  language: "zh-CN" | "en";
  label: string;
  content: string | undefined;
  failed: boolean;
  onRetry: () => void;
  client: AgentInstructionsClient;
}>) {
  const chinese = language === "zh-CN";
  const cache = useQueryClient();
  const [draft, setDraft] = useState<string>();
  const [targets, setTargets] = useState<AgentInstructionsTargets>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const value = draft ?? content ?? "";
  const unavailable =
    content === undefined ||
    failed ||
    !client.getAgentInstructionsTargets ||
    !client.saveAgentInstructions;
  async function preview() {
    if (!client.getAgentInstructionsTargets || loading || saving) return;
    setOpen(true);
    setLoading(true);
    setError(undefined);
    setTargets(undefined);
    try {
      setTargets(await client.getAgentInstructionsTargets());
    } catch {
      setError(
        chinese
          ? "无法读取 Agent 的全局指令文件。"
          : "Could not read the agents’ instruction files.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function confirm() {
    if (!targets || !client.saveAgentInstructions || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await cache.cancelQueries({ queryKey: ["application-preferences"], exact: true });
      const settings = await client.saveAgentInstructions({
        content: value,
        version: targets.version,
      });
      cache.setQueryData(["application-preferences"], { settings });
      setDraft(settings.globalInstructions);
      setSaved(true);
      setOpen(false);
    } catch {
      setTargets(undefined);
      setError(
        chinese
          ? "保存失败。请重新检查目标文件后确认。"
          : "Save failed. Check the target files again before confirming.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section id="settings-panel-global-instructions">
      <PersonalizationInstructionsEditor
        id="acp-global-instructions"
        label={label}
        description={
          chinese
            ? "确认保存后，已启用且支持同步的 Agent 会从各自的全局指令文件加载这段内容。保存会覆盖这些文件的原有内容。"
            : "After confirmation, enabled agents with file sync support load these instructions from their own global files. Saving replaces the contents of those files."
        }
        disabled={unavailable || saving}
        value={value}
        maxLength={MAX_ACP_GLOBAL_INSTRUCTIONS_LENGTH}
        onChange={(event) => {
          setDraft(event.target.value);
          setSaved(false);
        }}
      >
        {failed ? (
          <div role="alert" className="text-body-small text-danger">
            {chinese ? "读取全局指令失败。" : "Could not load global instructions."}
            <Button variant="ghost" onClick={onRetry}>
              {chinese ? "重试" : "Retry"}
            </Button>
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            ref={saveButton}
            disabled={unavailable || loading || saving}
            onClick={() => {
              void preview();
            }}
          >
            {chinese ? "保存" : "Save"}
          </Button>
          {saved ? (
            <span role="status" className="text-body-small text-muted-foreground">
              {chinese ? "已保存" : "Saved"}
            </span>
          ) : null}
        </div>
      </PersonalizationInstructionsEditor>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
      >
        <DialogContent
          closeLabel={chinese ? "关闭" : "Close"}
          closeDisabled={saving}
          finalFocus={saveButton}
          className="flex max-h-[min(36rem,calc(100dvh-2rem))] flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle>
              {chinese ? "确认保存全局指令" : "Confirm global instructions"}
            </DialogTitle>
            <DialogDescription>
              {chinese
                ? "确认后将覆盖下列已有文件，并创建缺失的文件。"
                : "Confirm to replace the existing files below and create any missing files."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-3 overflow-y-auto">
            {loading ? (
              <p role="status">{chinese ? "正在检查指令文件…" : "Checking instruction files…"}</p>
            ) : null}
            {error ? (
              <p role="alert" className="text-body-small text-danger">
                {error}
              </p>
            ) : null}
            {targets?.files.length ? (
              <ul className="space-y-2 text-body-small">
                {targets.files.map((file) => (
                  <li key={file.path}>
                    <p className="font-medium">
                      {file.agents.join("、")} ·{" "}
                      {file.exists ? (chinese ? "覆盖" : "Replace") : chinese ? "创建" : "Create"}
                    </p>
                    <code className="wrap-anywhere text-label text-muted-foreground">
                      {file.path}
                    </code>
                  </li>
                ))}
              </ul>
            ) : targets ? (
              <p className="text-body-small">
                {chinese
                  ? "当前没有可同步的文件，本次只保存应用内的指令。"
                  : "There are no files to sync. This will save the instructions in Codexly."}
              </p>
            ) : null}
            {targets?.unsupported.length ? (
              <p className="text-body-small text-muted-foreground">
                {chinese ? "尚无文件同步配置" : "File sync unavailable"} ·{" "}
                {targets.unsupported.join("、")}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setOpen(false);
              }}
            >
              {chinese ? "取消" : "Cancel"}
            </Button>
            {error ? (
              <Button
                type="button"
                onClick={() => {
                  void preview();
                }}
              >
                {chinese ? "重新检查" : "Check again"}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={!targets || saving}
                onClick={() => {
                  void confirm();
                }}
              >
                {chinese ? "确认保存" : "Confirm save"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
