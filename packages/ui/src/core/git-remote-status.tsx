import { useState } from "react";
import { GitBranch, LoaderCircle, RefreshCw, Upload } from "lucide-react";
import type {
  GitRemoteState,
  PushProjectCommitsRequest,
} from "@codexly/frontend-core/git-workspace-contract";
import { classifyGitFailure, type GitFailureKind } from "@codexly/frontend-core/git-recovery";
import { Button } from "./button.js";
import { GitRemoteConfigDialog } from "./git-remote-config-dialog.js";
import type { GitWorkspaceTranslate } from "./git-commit-editor.js";

// 远端动作共享同一请求通道，但必须分别展示进度，不能把获取、配置或合并误称为推送。
const pendingLabels: Record<NonNullable<PushProjectCommitsRequest["action"]>, string> = {
  push: "commit.pushing",
  fetch: "commit.fetchingRemote",
  inspect: "commit.inspectingRemote",
  configure: "commit.configuringRemote",
  publish: "commit.publishingBranch",
  integrate: "commit.integratingRemote",
  resolve: "commit.resolvingConflict",
  continue: "commit.continuingMerge",
  abort: "commit.abortingMerge",
  branch: "commit.creatingFeatureBranch",
};

export function GitRemoteStatus({
  branch,
  remote,
  pushStatus,
  pushError,
  commitSha,
  busy,
  activeAction,
  actionError,
  inspecting,
  onPush,
  onAction,
  onOpenConflict,
  savedFailureKind,
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
  inspecting: boolean;
  onOpenConflict?: ((path: string) => void) | undefined;
  savedFailureKind?: GitFailureKind | undefined;
  onPush: () => void;
  onAction?: (request: Omit<PushProjectCommitsRequest, "expectedSnapshot">) => Promise<boolean>;
  t: GitWorkspaceTranslate;
}>) {
  const [form, setForm] = useState<"configure" | "publish" | null>(null);
  const [remoteName, setRemoteName] = useState("");
  const [featureForm, setFeatureForm] = useState(false);
  const [featureName, setFeatureName] = useState("feature/recovery");
  const failureKind = pushError ? classifyGitFailure(pushError) : (savedFailureKind ?? "unknown");
  const failed = pushStatus === "failed" || pushStatus === "not_configured";
  const merge = remote?.operation === "merge";
  const noRemote = remote?.remotes.length === 0;
  const unpublished = remote?.upstream === null;
  const synced = remote?.ahead === 0 && remote.behind === 0;
  const needsUpdate = (remote?.behind ?? 0) > 0;
  const defaultRemote =
    (remoteName || null) ?? remote?.remote ?? remote?.remotes[0]?.name ?? "origin";
  const buttonLabel = activeAction
    ? t(pendingLabels[activeAction])
    : noRemote
      ? t("commit.configureRemote")
      : unpublished
        ? t("commit.publishBranch")
        : needsUpdate
          ? t("commit.integrateRemote")
          : synced
            ? t("commit.synced")
            : pushStatus === "pushed" && !remote
              ? t("commit.pushed")
              : failed
                ? t("commit.pushAgain")
                : t("commit.push");
  const statusLabel = noRemote
    ? t("commit.noRemote")
    : unpublished
      ? t("commit.unpublished")
      : needsUpdate
        ? (remote?.ahead ?? 0) > 0
          ? t("commit.diverged")
          : t("commit.behind", { count: remote?.behind ?? 0 })
        : synced
          ? t("commit.synced")
          : (remote?.ahead ?? 0) > 0
            ? t("commit.ahead", { count: remote?.ahead ?? 0 })
            : inspecting
              ? t("commit.awaitingCheck")
              : t("commit.pushPreservesChanges");
  const action = (request: Omit<PushProjectCommitsRequest, "expectedSnapshot">) => {
    void onAction?.(request);
  };
  return (
    <section
      className="max-h-[45%] shrink-0 overflow-y-auto border-b border-separator px-3 py-2"
      data-slot="git-remote-status"
      aria-label={t("commit.remoteStatus")}
    >
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-label font-semibold" title={branch ?? ""}>
          {branch ?? t("commit.detachedHead")}
        </span>
        <Button
          size="sm"
          variant="outline"
          type="button"
          aria-label={buttonLabel}
          disabled={
            busy || merge || synced || (pushStatus === "pushed" && !remote) || branch === null
          }
          onClick={() => {
            if (noRemote) setForm("configure");
            else if (unpublished) setForm("publish");
            else if (needsUpdate) action({ action: "integrate" });
            else onPush();
          }}
        >
          {busy ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="size-3.5" aria-hidden="true" />
          )}
          {buttonLabel}
        </Button>
        {onAction ? (
          <Button
            size="icon-sm"
            variant="ghost"
            type="button"
            aria-label={t("commit.inspectRemote")}
            disabled={busy}
            onClick={() => {
              action({ action: "inspect" });
            }}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {remote?.remote && remote.targetBranch ? (
        <p
          className="mt-1 truncate font-mono text-caption text-muted-foreground"
          title={`${remote.remote}/${remote.targetBranch}`}
        >
          {remote.remote}/{remote.targetBranch}
        </p>
      ) : null}
      <p className="mt-1 text-caption text-muted-foreground" role="status">
        {statusLabel}
      </p>
      {remote ? (
        <details className="mt-1 text-caption text-muted-foreground">
          <summary className="cursor-pointer">
            {t("commit.lastChecked", { time: new Date(remote.checkedAt).toLocaleTimeString() })}
          </summary>
          {remote.remotes.map((item) => (
            <p className="break-all" key={item.name}>
              {item.name} · {item.url}
            </p>
          ))}
          <div className="mt-1 flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || noRemote}
              onClick={() => {
                action({ action: "fetch" });
              }}
              type="button"
            >
              {t("commit.fetchRemote")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setForm("configure");
              }}
              type="button"
            >
              {t("commit.configureRemote")}
            </Button>
          </div>
        </details>
      ) : null}
      {commitSha ? (
        <p className="mt-2 text-caption" role="status">
          {failed
            ? t("commit.savedButPushFailed")
            : pushStatus === "pushed" || synced
              ? t("commit.pushedToRemote")
              : t("commit.savedLocally")}
          <code className="ml-1.5 font-mono">{commitSha.slice(0, 7)}</code>
        </p>
      ) : pushStatus === "pushed" ? (
        <p className="mt-2 text-caption" role="status">
          {t("commit.pushedToRemote")}
        </p>
      ) : null}
      {form === "configure" ? (
        <GitRemoteConfigDialog
          initialName={defaultRemote}
          initialUrl={remote?.remotes.find((item) => item.name === defaultRemote)?.url ?? ""}
          busy={busy}
          error={actionError}
          t={t}
          onClose={() => {
            setForm(null);
          }}
          onSave={(name, url) =>
            onAction?.({ action: "configure", remote: name, url }) ?? Promise.resolve(false)
          }
        />
      ) : null}
      {form === "publish" ? (
        <form
          className="mt-2 space-y-2 rounded-control border border-separator p-2 text-caption"
          onSubmit={(event) => {
            event.preventDefault();
            action({ action: "publish", remote: defaultRemote });
            setForm(null);
          }}
        >
          <label className="block">
            {t("commit.remoteName")}
            <select
              className="mt-1 h-8 w-full rounded-control border border-separator bg-panel px-2"
              value={defaultRemote}
              onChange={(event) => {
                setRemoteName(event.currentTarget.value);
              }}
            >
              {remote?.remotes.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name} · {item.url}
                </option>
              ))}
            </select>
          </label>
          <p className="break-words">
            {defaultRemote}/{branch}
          </p>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy}>
              {t("commit.publishBranch")}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                setForm(null);
              }}
            >
              {t("commit.cancel")}
            </Button>
          </div>
        </form>
      ) : null}
      {merge ? (
        <div
          className="mt-2 space-y-2 rounded-control border border-warning/30 bg-warning/5 p-2 text-caption"
          role="alert"
        >
          <p>{t("commit.mergeConflicts")}</p>
          {remote.conflicts.map((path) => (
            <div key={path} className="space-y-1">
              <p className="break-words font-mono">{path}</p>
              <div className="flex flex-wrap gap-1">
                {onOpenConflict ? (
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => {
                      onOpenConflict(path);
                    }}
                  >
                    {t("commit.editConflict")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    action({ action: "resolve", paths: [path] });
                  }}
                >
                  {t("commit.markResolved")}
                </Button>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              type="button"
              disabled={busy || remote.conflicts.length > 0}
              onClick={() => {
                action({ action: "continue" });
              }}
            >
              {t("commit.continueMerge")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={busy}
              onClick={() => {
                action({ action: "abort" });
              }}
            >
              {t("commit.abortMerge")}
            </Button>
          </div>
        </div>
      ) : null}
      {failed ? (
        <div
          role="alert"
          className="mt-2 space-y-2 rounded-control border border-warning/30 bg-warning/5 p-2 text-caption"
        >
          <p className="font-semibold">
            {pushStatus === "not_configured"
              ? t("commit.unpublished")
              : t(`commit.failure_${failureKind}`)}
          </p>
          <p className="text-muted-foreground">
            {pushStatus === "not_configured"
              ? t("commit.pushUpstreamMissing")
              : t(`commit.fix_${failureKind}`)}
          </p>
          {onAction ? (
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (pushStatus === "not_configured") setForm("publish");
                else if (failureKind === "protected_branch") setFeatureForm(true);
                else
                  action({
                    action: [
                      "remote_updates",
                      "unknown_result",
                      "authentication",
                      "network",
                    ].includes(failureKind)
                      ? "fetch"
                      : "inspect",
                  });
              }}
            >
              {t(
                pushStatus === "not_configured"
                  ? "commit.publishBranch"
                  : failureKind === "remote_updates"
                    ? "commit.fetchRemote"
                    : failureKind === "protected_branch"
                      ? "commit.createFeatureBranch"
                      : ["unknown_result", "authentication", "network"].includes(failureKind)
                        ? "commit.checkConnection"
                        : "commit.inspectRemote",
              )}
            </Button>
          ) : null}
          {featureForm ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                action({ action: "branch", branchName: featureName });
                setFeatureForm(false);
              }}
            >
              <label className="block">
                {t("commit.branchName")}
                <input
                  className="mt-1 h-8 w-full rounded-control border border-separator bg-panel px-2"
                  required
                  value={featureName}
                  onChange={(event) => {
                    setFeatureName(event.currentTarget.value);
                  }}
                />
              </label>
              <Button size="sm" type="submit" disabled={busy}>
                {t("commit.createFeatureBranch")}
              </Button>
            </form>
          ) : null}
          {pushError ? (
            <details>
              <summary className="cursor-pointer">{t("commit.viewDetails")}</summary>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono">
                {pushError}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
