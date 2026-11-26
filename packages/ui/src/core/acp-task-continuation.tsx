import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { agentEngineName, type AcpConfigOption, type AgentEngine } from "@codexly/protocol";
import { AcpModelSelector, type AcpModelSelectorProps } from "./acp-model-selector.js";
import { Button } from "./button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "./dialog.js";
import { useSelectedEngines } from "./engine-selection.js";
import { useAcpDraft, type AcpDraftClient } from "./use-acp-draft.js";

export function useAcpTaskContinuation(
  input: AcpModelSelectorProps & {
    client: Partial<AcpDraftClient>;
    projectId: string;
    taskId: string;
    workspace: string;
  },
) {
  const { client, projectId, taskId, workspace, engine, language } = input;
  const zh = language !== "en";
  const enabled = useSelectedEngines() ?? ["codex", "claude"];
  const engines: readonly AgentEngine[] = enabled.includes(engine) ? enabled : [engine, ...enabled];
  const [selection, select] = useState<{
    taskId: string;
    engine: AgentEngine;
    model?: { id: string; value: string };
  }>();
  const target = selection?.taskId === taskId ? selection : undefined;
  const targetEngine = target?.engine ?? engine;
  const preview = client.previewAcpConfig;
  const draft = useAcpDraft({
    client: client as AcpDraftClient,
    projectId,
    // 以来源任务和目标 Agent 恢复首发身份，普通新聊天拥有自己的草稿。
    draftId: JSON.stringify(["continuation", taskId, targetEngine]),
    engine: targetEngine,
    workspace,
    enabled: target !== undefined && preview !== undefined,
  });
  const [open, setOpen] = useState(false);
  const response = useRef<((confirmed: boolean) => void) | undefined>(undefined);
  const cancel = useRef<HTMLButtonElement>(null);
  const finish = useCallback((confirmed: boolean) => {
    const resolve = response.current;
    response.current = undefined;
    setOpen(false);
    resolve?.(confirmed);
  }, []);
  useLayoutEffect(
    () => () => {
      // 对话切换或窗口关闭时解除等待，迟到的确认不能发送到新任务。
      response.current?.(false);
      response.current = undefined;
    },
    [projectId, taskId],
  );

  useEffect(() => {
    if (!target?.model || !draft.preview || draft.isPending || draft.isSaving || draft.error)
      return;
    const { id, value } = target.model;
    select((current) => (current === target ? { taskId, engine: targetEngine } : current));
    void draft.setConfig(id, value);
  }, [
    draft.error,
    draft.isPending,
    draft.isSaving,
    draft.preview,
    draft.setConfig,
    target,
    targetEngine,
    taskId,
  ]);

  const loadOptions = useCallback(
    async (next: AgentEngine, signal: AbortSignal): Promise<readonly AcpConfigOption[]> => {
      if (!preview) return [];
      const config = await preview.call(
        client,
        projectId,
        next,
        {
          values: {},
          ...(projectId !== "temporary" && workspace ? { workspacePath: workspace } : {}),
        },
        { signal },
      );
      return config.configOptions;
    },
    [client, preview, projectId, workspace],
  );

  const selectTarget = (next: AgentEngine, model?: { id: string; value: string }) => {
    if (input.disabled || draft.isSaving || draft.hasSubmission) return;
    select(next === engine ? undefined : { taskId, engine: next, ...(model ? { model } : {}) });
    if (next === engine && model) input.onSelect(next, model.id, model.value);
  };
  const targetName = agentEngineName(targetEngine);
  return {
    ...draft,
    target: target?.engine,
    busy:
      target !== undefined &&
      (input.disabled ||
        draft.isPending ||
        draft.isSaving ||
        draft.error !== null ||
        target.model !== undefined),
    confirm: () => {
      if (response.current) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        response.current = resolve;
        setOpen(true);
      });
    },
    controls: (
      <>
        <AcpModelSelector
          {...input}
          engines={preview ? engines : [engine]}
          disabled={input.disabled || draft.isSaving || draft.hasSubmission}
          label={target && (zh ? `接续到 ${targetName}` : `Continue with ${targetName}`)}
          loadOptions={loadOptions}
          selectDefaultEngine={selectTarget}
          onSelect={(next, id, value) => {
            selectTarget(next, { id, value });
          }}
        />
        {target && draft.error ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            title={draft.error.message}
            onClick={() => void draft.reload()}
          >
            {zh ? "重试配置" : "Retry configuration"}
          </Button>
        ) : null}
        <Dialog
          open={open && target !== undefined}
          onOpenChange={(visible) => {
            if (!visible) finish(false);
          }}
        >
          <DialogContent
            role="alertdialog"
            initialFocus={cancel}
            showCloseButton={false}
            closeLabel={zh ? "关闭" : "Close"}
          >
            <DialogTitle>
              {zh ? `创建 ${targetName} 接续任务？` : `Create a continuation with ${targetName}?`}
            </DialogTitle>
            <DialogDescription>
              {zh
                ? "当前任务的聊天历史将整理为附件，和这条消息一起发送。"
                : "Part of this chat’s history will be sent as an attachment with your message."}
              {projectId === "temporary"
                ? zh
                  ? "接续任务使用独立的临时工作目录。"
                  : "The continuation will use a separate temporary workspace."
                : null}
            </DialogDescription>
            <DialogFooter>
              <Button
                ref={cancel}
                type="button"
                variant="outline"
                onClick={() => {
                  finish(false);
                }}
              >
                {zh ? "取消" : "Cancel"}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  finish(true);
                }}
              >
                {zh ? "创建并发送" : "Create and send"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    ),
  };
}
