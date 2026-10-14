import { useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronRight,
  GitBranch,
  LoaderCircle,
  Upload,
} from "lucide-react";
import type {
  GitRemoteState,
  PushProjectCommitsRequest,
} from "@codexly/frontend-core/git-workspace-contract";
import type { GitFailureKind } from "@codexly/frontend-core/git-recovery";
import {
  deriveGitRemotePresentation,
  gitRemotePendingLabels,
} from "@codexly/frontend-core/git-remote-presentation";
import { Button } from "./button.js";
import { GitRemoteConfigDialog } from "./git-remote-config-dialog.js";
import { GitRemoteDialog, type GitRemoteDialogKind } from "./git-remote-dialog.js";
import { GitRemoteMenu } from "./git-remote-menu.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";
import type { GitWorkspaceTranslate } from "./git-commit-editor.js";

type RemoteRequest = Omit<PushProjectCommitsRequest, "expectedSnapshot">;

/** 顶部只承载分支目标、同步摘要和下一步；详细信息与恢复表单不占用文件审查区域。 */
export function GitRemoteStatus({
  branch,
  remote,
  pushStatus,
  pushError,
  commitSha,
  busy,
  activeAction,
  actionError,
  failureOperation,
  inspecting,
  onPush,
  onAction,
  onOpenHistory,
  savedFailureKind,
  hasWorkingChanges = false,
  t,
}: Readonly<{
  branch: string | null;
  remote?: GitRemoteState | undefined;
  pushStatus: string | null;
  pushError: string | null;
  commitSha?: string | undefined;
  busy: boolean;
  activeAction: PushProjectCommitsRequest["action"] | null;
  actionError: string | null;
  failureOperation?:
    NonNullable<PushProjectCommitsRequest["action"]> | "commit" | "generate" | "status" | undefined;
  inspecting: boolean;
  hasWorkingChanges?: boolean;
  onOpenHistory?: (() => void) | undefined;
  savedFailureKind?: GitFailureKind | undefined;
  onPush: () => void;
  onAction?: (request: RemoteRequest) => Promise<boolean>;
  t: GitWorkspaceTranslate;
}>) {
  const primaryTrigger = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<{
    kind: GitRemoteDialogKind;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const view = deriveGitRemotePresentation({
    branch,
    remote,
    pushStatus,
    pushError,
    commitSha,
    actionError,
    failureOperation,
    inspecting,
    savedFailureKind,
    hasWorkingChanges,
    hasActions: !!onAction,
  });
  const { primary } = view;
  const defaultRemote = remote?.remote ?? remote?.remotes[0]?.name ?? "origin";
  const displayedError = actionError ?? pushError;
  const openDialog = (
    kind: GitRemoteDialogKind,
    returnFocus: HTMLElement | null = primaryTrigger.current,
  ) => {
    setDialog({ kind, returnFocus });
  };
  const closeDialog = () => {
    setDialog(null);
  };
  const operate = (request: RemoteRequest) => onAction?.(request) ?? Promise.resolve(false);
  const initialInspection = inspecting && !remote;
  const primaryPending = busy && activeAction === primary.action;
  // 非主按钮发起的获取仍保留“推送”名称，在获取入口显示进度，避免动作语义跳变。
  const primaryLabel = t(
    initialInspection
      ? "commit.inspectingRemote"
      : primaryPending && activeAction
        ? gitRemotePendingLabels[activeAction]
        : primary.labelKey,
  );
  const showFetchShortcut = !!onAction && !!remote?.remotes.length && primary.action !== "fetch";
  const fetchLabel = t(
    activeAction === "fetch" && busy ? "commit.fetchingRemote" : "commit.fetchRemote",
  );
  const failure =
    dialog && !["info", "error", "guidance"].includes(dialog.kind) ? null : view.failure;
  const ahead = remote?.ahead ?? 0;
  const behind = remote?.behind ?? 0;
  const hasNotice = !!failure || !!primary.disabledReason || !!view.hintKey;
  const compactCounts = hasNotice || (ahead > 0 && behind > 0);
  const emphasizedAction = ["push", "publish", "integrate"].includes(primary.action ?? "");
  // 视觉文案保持简短；完整操作名称仍用于可访问标签、进度和悬停说明。
  const compactLabelKeys: Readonly<Record<string, string>> = {
    "commit.fetchRemote": "commit.fetchShort",
    "commit.refreshGitStatus": "commit.refreshShort",
    "commit.checkConnection": "commit.checkConnectionShort",
    "commit.createFeatureBranch": "commit.branchShort",
  };
  const visiblePrimaryLabel =
    !primaryPending && !initialInspection && compactLabelKeys[primary.labelKey]
      ? t(compactLabelKeys[primary.labelKey] ?? primary.labelKey)
      : primaryLabel;
  const counts = view.summaryKey !== "commit.mergePending" && (ahead > 0 || behind > 0);
  const target =
    remote?.remote && remote.targetBranch ? `${remote.remote}/${remote.targetBranch}` : null;
  return (
    <section
      className="h-[72px] shrink-0 overflow-hidden border-b border-separator px-3 py-1.5"
      data-slot="git-remote-status"
      aria-label={t("commit.remoteStatus")}
    >
      <div className="flex h-7 min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span
            className="min-w-0 truncate text-caption font-medium"
            title={branch ?? t("commit.detachedHead")}
          >
            {branch ?? t("commit.detachedHead")}
          </span>
          {target ? (
            <>
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span
                className="min-w-0 max-w-[45%] truncate text-caption text-muted-foreground"
                title={target}
              >
                {target}
              </span>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {showFetchShortcut ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-toolbar"
                  variant="ghost"
                  type="button"
                  aria-label={fetchLabel}
                  disabled={busy || !branch}
                  onClick={() => {
                    void operate({ action: "fetch" });
                  }}
                >
                  {activeAction === "fetch" && busy ? (
                    <LoaderCircle
                      className="size-3.5 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <ArrowDownToLine className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("commit.fetchRemoteHint")}</TooltipContent>
            </Tooltip>
          ) : null}
          {onAction ? (
            <GitRemoteMenu
              busy={busy}
              canPublish={!!remote?.remotes.length && remote.upstream === null}
              dialogOpen={dialog !== null}
              onInspect={() => {
                void operate({ action: "inspect" });
              }}
              onOpen={openDialog}
              t={t}
            />
          ) : null}
        </div>
      </div>
      <div className="mt-1.5 flex h-6 min-w-0 items-center gap-2" data-slot="git-remote-summary">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className={`flex min-w-0 items-center gap-1.5 text-caption ${hasNotice ? "max-w-[50%]" : "flex-1"}`}
            role="status"
          >
            {counts ? (
              <>
                {ahead > 0 ? (
                  onOpenHistory ? (
                    <button
                      className="inline-flex h-6 min-w-0 max-w-full touch-manipulation items-center gap-1.5 rounded-control bg-brand/10 px-1.5 text-brand-strong outline-none hover:bg-brand/15 focus-visible:shadow-focus"
                      type="button"
                      data-slot="git-open-unpushed-history"
                      aria-label={t("commit.ahead", { count: ahead })}
                      title={t("commit.ahead", { count: ahead })}
                      onClick={onOpenHistory}
                    >
                      <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">
                        {t(compactCounts ? "commit.aheadShort" : "commit.ahead", { count: ahead })}
                      </span>
                    </button>
                  ) : (
                    <span
                      className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-control bg-brand/10 px-1.5 text-brand-strong"
                      title={t("commit.ahead", { count: ahead })}
                    >
                      <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {t(compactCounts ? "commit.aheadShort" : "commit.ahead", { count: ahead })}
                      </span>
                    </span>
                  )
                ) : null}
                {behind > 0 ? (
                  <span
                    className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-control bg-control px-1.5 text-muted-foreground"
                    title={t("commit.behind", { count: behind })}
                  >
                    <ArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {t(compactCounts ? "commit.behindShort" : "commit.behind", { count: behind })}
                    </span>
                  </span>
                ) : null}
              </>
            ) : !hasNotice ? (
              <span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-control bg-control px-1.5 text-muted-foreground">
                {view.summaryKey === "commit.synced" ||
                view.summaryKey === "commit.pushedToRemote" ? (
                  <Check className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : null}
                <span className="min-w-0 truncate">{t(view.summaryKey)}</span>
              </span>
            ) : null}
          </div>
          {/* 状态与短提示共用第二行，不额外预留空白；主按钮固定在状态行右侧，切换状态保持固定高度。 */}
          {hasNotice ? (
            <div className="flex h-6 min-w-0 flex-1 items-center text-caption">
              {failure ? (
                <div
                  role="alert"
                  className="flex h-full min-w-0 flex-1 items-center gap-1.5"
                  data-slot="git-remote-notice"
                >
                  <AlertCircle className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
                  <p
                    className="min-w-0 flex-1 truncate text-muted-foreground"
                    title={t(failure.titleKey)}
                  >
                    {t(failure.titleKey)}
                  </p>
                  <button
                    className="min-h-6 shrink-0 touch-manipulation rounded-sm text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:shadow-focus"
                    type="button"
                    aria-label={t("commit.viewDetails")}
                    onClick={(event) => {
                      openDialog("error", event.currentTarget);
                    }}
                  >
                    {t("commit.detailsShort")}
                  </button>
                </div>
              ) : primary.disabledReason ? (
                <p
                  className="min-w-0 truncate text-muted-foreground"
                  title={t(primary.disabledReason)}
                >
                  {t(primary.disabledReason)}
                </p>
              ) : view.hintKey ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
                  <p className="min-w-0 flex-1 truncate">{t("commit.externalGitRequired")}</p>
                  <button
                    className="min-h-6 shrink-0 touch-manipulation rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:shadow-focus"
                    type="button"
                    aria-label={t("commit.viewDetails")}
                    onClick={(event) => {
                      openDialog("guidance", event.currentTarget);
                    }}
                  >
                    {t("commit.detailsShort")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {primary.action ? (
          <Button
            ref={primaryTrigger}
            size="toolbar"
            variant={emphasizedAction ? "default" : "outline"}
            className={emphasizedAction ? "text-[color:light-dark(#ffffff,#181818)]" : undefined}
            type="button"
            data-slot="git-remote-primary"
            aria-label={primaryLabel}
            title={primaryLabel}
            disabled={
              busy ||
              initialInspection ||
              !!primary.disabledReason ||
              (primary.action !== "push" && !onAction)
            }
            onClick={() => {
              const action = primary.action;
              if (action === "push") onPush();
              else if (action === "configure" || action === "publish" || action === "branch")
                openDialog(action);
              else if (action) void operate({ action });
            }}
          >
            {primaryPending || initialInspection ? (
              <LoaderCircle
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : primary.action === "push" || primary.action === "publish" ? (
              <Upload className="size-3.5" aria-hidden="true" />
            ) : null}
            {visiblePrimaryLabel}
          </Button>
        ) : null}
      </div>
      {dialog?.kind === "configure" ? (
        <GitRemoteConfigDialog
          initialName={defaultRemote}
          initialUrl={remote?.remotes.find((item) => item.name === defaultRemote)?.url ?? ""}
          busy={busy}
          returnFocusElement={dialog.returnFocus}
          error={
            failureOperation === "configure" && actionError
              ? t(
                  view.failure?.kind === "invalid_remote"
                    ? "commit.fix_invalid_remote"
                    : "commit.remoteSaveFailed",
                )
              : null
          }
          onSave={(name, url) => operate({ action: "configure", remote: name, url })}
          onClose={closeDialog}
          t={t}
        />
      ) : null}
      {dialog && dialog.kind !== "configure" ? (
        <GitRemoteDialog
          kind={dialog.kind}
          branch={branch}
          remote={remote}
          commitSha={commitSha}
          defaultRemote={defaultRemote}
          busy={busy}
          error={displayedError}
          failure={view.failure}
          guidanceKey={view.hintKey}
          returnFocus={dialog.returnFocus}
          onAction={operate}
          onClose={closeDialog}
          t={t}
        />
      ) : null}
    </section>
  );
}
