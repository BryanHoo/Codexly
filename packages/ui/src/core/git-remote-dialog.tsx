import { useId, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type {
  GitRemoteState,
  PushProjectCommitsRequest,
} from "@codexly/frontend-core/git-workspace-contract";
import type { GitRemoteFailure } from "@codexly/frontend-core/git-remote-presentation";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";
import type { GitWorkspaceTranslate } from "./git-commit-editor.js";

export type GitRemoteDialogKind =
  "configure" | "publish" | "branch" | "info" | "error" | "guidance";
type RemoteRequest = Omit<PushProjectCommitsRequest, "expectedSnapshot">;

/** 附加信息与恢复流程按需打开；失败保留表单，提交成功才退出，关闭后回到原来的操作入口。 */
export function GitRemoteDialog({
  kind,
  branch,
  remote,
  commitSha,
  defaultRemote,
  busy,
  error,
  failure,
  guidanceKey,
  returnFocus,
  onAction,
  onClose,
  t,
}: Readonly<{
  kind: Exclude<GitRemoteDialogKind, "configure">;
  branch: string | null;
  remote?: GitRemoteState | undefined;
  commitSha?: string | undefined;
  defaultRemote: string;
  busy: boolean;
  error: string | null;
  failure: GitRemoteFailure | null;
  guidanceKey?: string | undefined;
  returnFocus: HTMLElement | null;
  onAction: (request: RemoteRequest) => Promise<boolean>;
  onClose: () => void;
  t: GitWorkspaceTranslate;
}>) {
  const id = useId();
  const [name, setName] = useState(defaultRemote);
  const [branchName, setBranchName] = useState("feature/recovery");
  const [failed, setFailed] = useState(false);
  const titles = {
    publish: "commit.publishBranch",
    branch: "commit.createFeatureBranch",
    info: "commit.remoteInfo",
    error: "commit.operationDetails",
    guidance: "commit.gitOperationHelp",
  };
  const description =
    kind === "publish"
      ? "commit.publishHelp"
      : kind === "branch"
        ? "commit.featureBranchHelp"
        : kind === "info"
          ? "commit.remoteInfoHelp"
          : kind === "guidance"
            ? guidanceKey
            : (guidanceKey ?? failure?.helpKey);
  const submit = async (request: RemoteRequest) => {
    if (busy) return;
    setFailed(false);
    try {
      if (await onAction(request)) onClose();
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  };
  // 发布动作显式创建当前分支的同名远端分支，不复用普通推送的 upstream 目标。
  const destination = `${name}/${branch ?? ""}`;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(kind === "error" && failure ? failure.titleKey : titles[kind])}
          </DialogTitle>
          {description ? <DialogDescription>{t(description)}</DialogDescription> : null}
        </DialogHeader>
        {kind === "error" && commitSha && failure?.remote ? (
          <p className="text-caption text-muted-foreground">{t("commit.localCommitSafe")}</p>
        ) : null}
        {kind === "publish" || kind === "branch" ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(
                kind === "publish"
                  ? { action: "publish", remote: name }
                  : { action: "branch", branchName: branchName.trim() },
              );
            }}
          >
            {kind === "publish" ? (
              <>
                <label htmlFor={id} className="block text-label">
                  {t("commit.remoteName")}
                </label>
                <select
                  id={id}
                  className="h-9 w-full rounded-control border border-separator-strong bg-panel px-2 text-body-small outline-none focus-visible:shadow-focus"
                  value={name}
                  disabled={busy}
                  onChange={(event) => {
                    setName(event.currentTarget.value);
                  }}
                >
                  {remote?.remotes.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <div className="rounded-control bg-control px-3 py-2 text-caption">
                  <p className="text-muted-foreground">{t("commit.pushDestination")}</p>
                  <p className="break-all font-mono">{destination}</p>
                  <p className="mt-1 break-all text-muted-foreground">
                    {remote?.remotes.find((item) => item.name === name)?.url}
                  </p>
                </div>
              </>
            ) : (
              <label className="block text-label">
                {t("commit.branchName")}
                <input
                  className="mt-1 h-9 w-full rounded-control border border-separator-strong bg-panel px-2 outline-none focus-visible:shadow-focus"
                  required
                  maxLength={1024}
                  value={branchName}
                  disabled={busy}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(event) => {
                    setBranchName(event.currentTarget.value);
                  }}
                />
              </label>
            )}
            {failed ? (
              <p role="alert" className="text-caption text-warning">
                {t(kind === "publish" ? "commit.publishFailedHelp" : "commit.branchFailedHelp")}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                {t("commit.cancel")}
              </Button>
              <Button
                type="submit"
                className="text-[color:light-dark(#ffffff,#181818)]"
                disabled={busy || (kind === "branch" ? !branchName.trim() : !name)}
              >
                {busy ? (
                  <LoaderCircle
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
                {t(
                  busy
                    ? kind === "publish"
                      ? "commit.publishingBranch"
                      : "commit.creatingFeatureBranch"
                    : titles[kind],
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
        {kind === "info" ? (
          <>
            <dl className="space-y-3 text-caption">
              <div>
                <dt className="text-muted-foreground">{t("commit.currentBranch")}</dt>
                <dd className="break-all font-mono">{branch ?? t("commit.detachedHead")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("commit.pushDestination")}</dt>
                <dd className="break-all font-mono">
                  {remote?.remote && remote.targetBranch
                    ? `${remote.remote}/${remote.targetBranch}`
                    : t("commit.unpublished")}
                </dd>
              </div>
              {remote?.remotes.map((item) => (
                <div key={item.name}>
                  <dt className="text-muted-foreground">{item.name}</dt>
                  <dd className="break-all font-mono">{item.url}</dd>
                </div>
              ))}
              {commitSha ? (
                <div>
                  <dt className="text-muted-foreground">{t("commit.lastCommit")}</dt>
                  <dd className="break-all font-mono">{commitSha}</dd>
                </div>
              ) : null}
            </dl>
            {remote ? (
              <p className="text-caption text-muted-foreground">
                {t("commit.lastChecked", { time: new Date(remote.checkedAt).toLocaleTimeString() })}
              </p>
            ) : null}
          </>
        ) : null}
        {kind === "error" && error ? (
          <div className="space-y-2">
            <p className="text-caption text-muted-foreground">{t("commit.technicalDetails")}</p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-control bg-control p-3 font-mono text-caption">
              {error}
            </pre>
          </div>
        ) : null}
        {kind === "info" || kind === "error" || kind === "guidance" ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("commit.close")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
