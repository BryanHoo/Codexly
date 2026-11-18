import { useRef, useState, type RefObject } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { v4 as uuid } from "uuid";
import type { AcpAgentCatalogPage } from "@codexly/protocol";
import type { AcpCatalogClient } from "./acp-catalog-settings.js";
import { AcpStage, useAcpCatalogProgress } from "./acp-catalog-progress.js";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";
import { SettingsSaveStatus } from "./settings-save-status.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";
import { toast } from "./notifications.js";

export function AcpAgentMaintenance({
  agent,
  client,
  zh,
  disabled,
  onPendingChange,
  onChanged,
  navigate,
  fallbackFocus,
}: Readonly<{
  agent: AcpAgentCatalogPage["agents"][number];
  client: Partial<AcpCatalogClient>;
  zh: boolean;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
  onChanged: (page: AcpAgentCatalogPage, removed: boolean) => void;
  navigate: (action: () => void) => void;
  fallbackFocus: RefObject<HTMLButtonElement | null>;
}>) {
  const [confirming, setConfirming] = useState(false);
  const [action, setAction] = useState<"update" | "remove">();
  const [error, setError] = useState<"update" | "remove">();
  const pending = useRef<Promise<boolean> | undefined>(undefined);
  const removeButton = useRef<HTMLButtonElement>(null);
  const removed = useRef(false);
  const progress = useAcpCatalogProgress(client, !!action);
  const current = progress?.operations.find((operation) => operation.engine === agent.engine);
  const run = (next: "update" | "remove") => {
    const mutate = next === "update" ? client.updateAcpAgent : client.removeAcpAgent;
    if (pending.current || !mutate) return;
    setAction(next);
    setError(undefined);
    onPendingChange(true);
    pending.current = Promise.resolve()
      .then(() => mutate.call(client, agent.engine, { idempotencyKey: uuid() }))
      .then((result) => {
        if (next === "remove") {
          removed.current = true;
          setConfirming(false);
        } else toast.success(zh ? "已更新 Agent" : "Agent updated");
        onChanged(result, next === "remove");
        return true;
      })
      .catch(() => {
        setError(next);
        return false;
      })
      .finally(() => {
        pending.current = undefined;
        setAction(undefined);
        onPendingChange(false);
      });
  };
  const close = zh ? "关闭" : "Close";
  const updateLabel = zh ? "更新 Agent" : "Update agent";
  const removeLabel = zh ? "移除 Agent" : "Remove agent";
  return (
    <>
      <div className="col-start-3 row-start-1 flex shrink-0 items-center gap-0.5">
        <SettingsSaveStatus
          status="idle"
          labels={{ saving: "", saved: "", saveError: "", retry: "" }}
          onRetry={() => undefined}
          beforeLeave={async () => {
            await pending.current;
            return true;
          }}
        />
        {agent.canUpdate && client.updateAcpAgent ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-compact"
                aria-label={updateLabel}
                aria-busy={action === "update"}
                disabled={disabled || !!action}
                onClick={() => {
                  navigate(() => {
                    run("update");
                  });
                }}
              >
                <RefreshCw
                  className={action === "update" ? "size-4 motion-safe:animate-spin" : "size-4"}
                  aria-hidden="true"
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{updateLabel}</TooltipContent>
          </Tooltip>
        ) : null}
        {client.removeAcpAgent ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={removeButton}
                type="button"
                variant="ghost"
                size="icon-compact"
                className="hover:text-danger"
                aria-label={removeLabel}
                disabled={disabled || !!action}
                onClick={() => {
                  navigate(() => {
                    setError(undefined);
                    setConfirming(true);
                  });
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{removeLabel}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {/* 进度和错误单独跨列，避免长状态文本挤压版本与图标。 */}
      {action === "update" || error === "update" ? (
        <div className="col-span-full row-start-2 mt-2">
          {action === "update" ? (
            <AcpStage zh={zh} progress={current?.progress} />
          ) : (
            <p className="text-label text-danger" role="alert">
              {zh ? "未能确认更新结果，请重试" : "Could not confirm the update. Try again."}
            </p>
          )}
        </div>
      ) : null}
      {client.removeAcpAgent ? (
        <Dialog
          open={confirming}
          onOpenChange={(open) => {
            if (!action) setConfirming(open);
          }}
        >
          <DialogContent
            closeLabel={close}
            closeDisabled={!!action}
            finalFocus={() => (removed.current ? fallbackFocus.current : removeButton.current)}
          >
            <DialogHeader>
              <DialogTitle className="break-words">
                {zh ? `移除 ${agent.name}？` : `Remove ${agent.name}?`}
              </DialogTitle>
              <DialogDescription>
                {zh
                  ? "已保存的会话和本机安装的程序不会被删除。"
                  : "Saved conversations and programs installed outside Codexly will not be deleted."}
              </DialogDescription>
            </DialogHeader>
            {action === "remove" ? (
              <AcpStage zh={zh} progress={current?.progress ?? { stage: "removing" }} />
            ) : null}
            {error === "remove" ? (
              <p className="text-label text-danger" role="alert">
                {zh ? "移除失败，请重试" : "Removal failed. Try again."}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={!!action}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {zh ? "取消" : "Cancel"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!!action}
                onClick={() => {
                  run("remove");
                }}
              >
                {zh ? "移除" : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
