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
  const [title = "", ...bodyLines] = draft.message.split("\n");
  const body = bodyLines.join("\n").replace(/^\n/u, "");
  return (
    <div className="space-y-2" data-slot="git-commit-editor">
      <div className="flex items-center justify-between gap-2">
        <label className="text-label font-semibold" htmlFor="commit-message">
          {t("commit.commitMessage")}
        </label>
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
      <textarea
        id="commit-message"
        aria-label={t("commit.commitMessage")}
        className="block min-h-12 w-full resize-none rounded-control border border-separator-strong bg-panel px-2 py-1.5 text-label leading-5 outline-none focus-visible:shadow-focus"
        rows={2}
        maxLength={10_000}
        disabled={disabled}
        placeholder={t("commit.messagePlaceholder")}
        value={title}
        onChange={(event) => {
          const value = event.currentTarget.value;
          update((current) => ({
            ...current,
            message: body ? `${value}\n\n${body}` : value,
            previousMessage: null,
          }));
        }}
      />
      <details open={body !== "" ? true : undefined} className="text-caption">
        <summary className="cursor-pointer text-muted-foreground">
          {t("commit.addDescription")}
        </summary>
        <textarea
          aria-label={t("commit.description")}
          className="mt-2 block max-h-32 min-h-16 w-full rounded-control border border-separator-strong bg-panel p-2 text-label outline-none focus-visible:shadow-focus"
          rows={3}
          maxLength={10_000 - title.length - 2}
          value={body}
          disabled={disabled}
          onChange={(event) => {
            const value = event.currentTarget.value;
            update((current) => ({
              ...current,
              message: value ? `${title}\n\n${value}` : title,
              previousMessage: null,
            }));
          }}
        />
      </details>
      {draft.suggestion === null ? null : (
        <div
          className="space-y-2 rounded-control border border-separator bg-raised p-2"
          role="status"
        >
          <p className="text-caption font-semibold">{t("commit.aiSuggestion")}</p>
          <p className="whitespace-pre-wrap break-words text-label">{draft.suggestion}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              type="button"
              onClick={() => {
                update((current) => ({
                  ...current,
                  message: current.suggestion ?? current.message,
                  previousMessage: current.message,
                  suggestion: null,
                }));
              }}
            >
              {t("commit.useSuggestion")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => {
                update((current) => ({ ...current, suggestion: null }));
              }}
            >
              {t("commit.keepDraft")}
            </Button>
          </div>
        </div>
      )}
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
    </div>
  );
}
