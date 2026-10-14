import { LoaderCircle, Sparkles } from "lucide-react";
import type { CommitDraft } from "@codexly/frontend-core/git-commit-draft";
import { Button } from "./button.js";

export type GitWorkspaceTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function GitCommitEditor({
  draft,
  generating,
  disabled,
  canGenerate,
  onGenerate,
  update,
  t,
}: Readonly<{
  draft: CommitDraft;
  generating: boolean;
  disabled: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  update: (transform: (draft: CommitDraft) => CommitDraft) => void;
  t: GitWorkspaceTranslate;
}>) {
  return (
    <div className="space-y-2" data-slot="git-commit-editor">
      <div className="flex items-center justify-between gap-2">
        <label className="text-label font-semibold" htmlFor="commit-message">
          {t("commit.commitMessage")}
        </label>
        <div className="flex shrink-0 items-center gap-1">
          {draft.previousMessage === null ? null : (
            <Button
              size="sm"
              variant="link"
              type="button"
              onClick={() => {
                update((current) => ({
                  ...current,
                  message: current.previousMessage ?? "",
                  previousMessage: null,
                }));
              }}
            >
              {t("commit.undoGeneration")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={!canGenerate || generating}
            onClick={onGenerate}
            type="button"
            aria-label={t("commit.generateMessage")}
          >
            {generating ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-3.5" aria-hidden="true" />
            )}
            {generating ? t("commit.generatingMessage") : t("commit.generateMessage")}
          </Button>
        </div>
      </div>
      <textarea
        id="commit-message"
        aria-label={t("commit.commitMessage")}
        className="block min-h-12 w-full resize-none rounded-control border border-separator-strong bg-panel px-2 py-1.5 text-label leading-5 outline-none focus-visible:shadow-focus"
        rows={2}
        maxLength={10_000}
        disabled={disabled}
        placeholder={t("commit.messagePlaceholder")}
        value={draft.message}
        onChange={(event) => {
          const value = event.currentTarget.value;
          update((current) => ({
            ...current,
            // 单一输入框直接保存全文，保留旧草稿及 AI 结果中的换行，避免隐藏内容被误提交。
            message: value,
            previousMessage: null,
          }));
        }}
      />
    </div>
  );
}
