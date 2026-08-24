import type {
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  GenerateCommitMessageRequest,
  ProjectGitStatus,
} from "@codexly/protocol";
import { Check, ChevronDown, LoaderCircle, Sparkles, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { PromptInputButton } from "../../../shared/components/agent/prompt-input-controls.js";
import { Button } from "../../../shared/components/core/button.js";
import { ButtonGroup } from "../../../shared/components/core/button-group.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "../../../shared/components/core/input-group.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/components/core/select.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { CommitChangesTreeSection } from "./commit-changes-tree.js";

type CommitFileEntry = Readonly<{
  path: string;
  staged: boolean;
  unstaged: boolean;
}>;

type CommitChangesPanelProps = Readonly<{
  error?: Error | null;
  gitStatus: ProjectGitStatus;
  isCommitting?: boolean;
  isGenerating?: boolean;
  isRepositoryLoading?: boolean;
  onCommit: (request: CommitProjectChangesRequest) => Promise<void>;
  onGenerateMessage: (request: GenerateCommitMessageRequest) => Promise<string>;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onSelectRepository?: (repository: string) => void;
  repositories?: readonly string[];
  result?: CommitProjectChangesResponse | null;
  selectedRepository?: string | null;
}>;

export function collectCommitFileEntries(status: ProjectGitStatus): readonly CommitFileEntry[] {
  const entries = new Map<string, { path: string; staged: boolean; unstaged: boolean }>();
  for (const change of status.staged) {
    entries.set(change.path, { path: change.path, staged: true, unstaged: false });
  }
  for (const change of status.unstaged) {
    const current = entries.get(change.path);
    entries.set(change.path, {
      path: change.path,
      staged: current?.staged ?? false,
      unstaged: true,
    });
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

export function collectCommitRepositories(status: ProjectGitStatus): readonly string[] {
  if (status.repositoryMode !== "children") {
    return [];
  }
  const repositories = new Set<string>();
  for (const change of [...status.staged, ...status.unstaged]) {
    const separator = change.path.indexOf("/");
    if (separator > 0) {
      repositories.add(change.path.slice(0, separator));
    }
  }
  return [...repositories].toSorted((left, right) => left.localeCompare(right, "en"));
}

function createCommitContentState(identity: string, entries: readonly CommitFileEntry[]) {
  return {
    identity,
    message: "",
    selectedPaths: new Set(entries.map((entry) => entry.path)),
  };
}

export function CommitChangesPanel({
  error = null,
  gitStatus,
  isCommitting = false,
  isGenerating = false,
  isRepositoryLoading = false,
  onCommit,
  onGenerateMessage,
  onOpenFileDiff,
  onSelectRepository = () => undefined,
  repositories = [],
  result = null,
  selectedRepository = null,
}: CommitChangesPanelProps) {
  const { t } = useTranslation("workbench");
  const entries = useMemo(() => collectCommitFileEntries(gitStatus), [gitStatus]);
  const contentIdentity = `${selectedRepository ?? "root"}:${gitStatus.snapshot}`;
  const [contentState, setContentState] = useState(() =>
    createCommitContentState(contentIdentity, entries),
  );
  const commitActionLockRef = useRef(createAsyncActionLock());
  if (contentState.identity !== contentIdentity) {
    // 仓库或快照变化后重置选择和 message，避免提交过期状态。
    setContentState(createCommitContentState(contentIdentity, entries));
  }
  const { message, selectedPaths } = contentState;
  const isPending = isGenerating || isCommitting;
  const requiresRepository = repositories.length > 0 || gitStatus.repositoryMode === "children";
  const repositoryReady =
    !requiresRepository ||
    (selectedRepository !== null && !isRepositoryLoading && gitStatus.repositoryMode === "root");
  const canGenerate = repositoryReady && selectedPaths.size > 0 && !isPending && result === null;
  const canCommit = canGenerate && message.trim().length > 0;

  const generateMessage = () =>
    commitActionLockRef.current.run(async () => {
      const generated = await onGenerateMessage({
        expectedSnapshot: gitStatus.snapshot,
        paths: [...selectedPaths],
        ...(selectedRepository === null ? {} : { repository: selectedRepository }),
      });
      setContentState((current) => ({ ...current, message: generated }));
    });

  const commit = (action: CommitProjectChangesRequest["action"]) =>
    commitActionLockRef.current.run(() =>
      onCommit({
        action,
        expectedSnapshot: gitStatus.snapshot,
        message,
        paths: [...selectedPaths],
        ...(selectedRepository === null ? {} : { repository: selectedRepository }),
      }),
    );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="commit-changes-panel">
      {requiresRepository ? (
        <div className="shrink-0 border-b border-separator px-3 py-2">
          <label className="text-label font-medium" id="commit-repository-label">
            {t("commit.repository")}
          </label>
          <Select
            disabled={isPending || result !== null}
            onValueChange={onSelectRepository}
            {...(selectedRepository === null ? {} : { value: selectedRepository })}
          >
            <SelectTrigger aria-labelledby="commit-repository-label" className="mt-1 w-full">
              <SelectValue placeholder={t("commit.selectRepository")} />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {repositories.map((repository) => (
                  <SelectItem key={repository} value={repository}>
                    {repository}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {isRepositoryLoading ? (
            <p className="mt-1 text-caption text-muted-foreground" role="status">
              {t("commit.repositoryLoading")}
            </p>
          ) : null}
          {repositories.length === 0 ? (
            <p className="mt-1 text-caption text-danger" role="alert">
              {t("commit.repositoryUnavailable")}
            </p>
          ) : null}
        </div>
      ) : null}

      {error === null ? null : (
        <p className="mx-3 mt-2 shrink-0 text-caption text-danger" role="alert">
          {error.message}
        </p>
      )}

      {repositoryReady ? (
        <>
          <section className="shrink-0 px-3 py-2">
            <InputGroup className="h-8 gap-1 rounded-surface border border-separator-strong bg-panel shadow-sm focus-within:border-brand focus-within:shadow-focus max-workbench:h-11">
              <InputGroupTextarea
                aria-label={t("commit.commitMessage")}
                className="h-full min-h-0 overflow-y-auto px-2 py-1.5 text-label leading-5 max-workbench:py-3"
                disabled={isPending || result !== null}
                id="commit-message"
                onChange={(event) => {
                  const nextMessage = event.currentTarget.value;
                  setContentState((current) => ({ ...current, message: nextMessage }));
                }}
                placeholder={t("commit.messagePlaceholder")}
                rows={1}
                value={message}
              />
              <InputGroupAddon align="inline-end" className="ml-auto">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PromptInputButton
                      aria-label={t("commit.generateMessage")}
                      className="size-7 shrink-0 justify-center p-0 [&_svg]:size-3.5 max-workbench:size-11"
                      disabled={!canGenerate}
                      onClick={() => {
                        void generateMessage().catch(() => undefined);
                      }}
                      type="button"
                    >
                      {isGenerating ? (
                        <LoaderCircle aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Sparkles aria-hidden="true" />
                      )}
                    </PromptInputButton>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("commit.generateMessage")}</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>

            {result === null ? (
              <ButtonGroup className="mt-2 w-full">
                <Button
                  className="flex-1 rounded-r-none"
                  disabled={!canCommit}
                  onClick={() => {
                    void commit("commit").catch(() => undefined);
                  }}
                  type="button"
                >
                  {isCommitting ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Check aria-hidden="true" />
                  )}
                  {t("commit.commit")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label={t("commit.commitActions")}
                      className="w-10 rounded-l-none border-l border-brand-contrast/30 px-0"
                      disabled={!canCommit}
                      type="button"
                    >
                      <ChevronDown aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onSelect={() => {
                          void commit("commit").catch(() => undefined);
                        }}
                      >
                        <Check aria-hidden="true" className="size-3.5" />
                        {t("commit.commit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          void commit("commit_and_push").catch(() => undefined);
                        }}
                      >
                        <Upload aria-hidden="true" className="size-3.5" />
                        {t("commit.commitAndPush")}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            ) : (
              <p className="mt-2 font-mono text-caption text-muted-foreground" role="status">
                {result.commitSha.slice(0, 7)}
              </p>
            )}
          </section>

          <div className="flex min-h-0 flex-1 flex-col border-t border-separator">
            <div className="flex h-8 shrink-0 items-center px-3 text-label font-semibold">
              <span>{t("commit.changes")}</span>
              <span className="ml-auto text-caption font-normal text-muted-foreground">
                {t("commit.totalFiles", { count: entries.length })}
              </span>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-0.5"
              data-slot="commit-changes-scroll"
            >
              <CommitChangesTreeSection
                changes={gitStatus.staged}
                disabled={isPending || result !== null}
                label={t("commit.staged")}
                onOpenFileDiff={onOpenFileDiff}
                onSelectedPathsChange={(paths) => {
                  setContentState((current) => ({ ...current, selectedPaths: paths }));
                }}
                selectedPaths={selectedPaths}
              />
              <CommitChangesTreeSection
                changes={gitStatus.unstaged}
                disabled={isPending || result !== null}
                label={t("commit.unstaged")}
                onOpenFileDiff={onOpenFileDiff}
                onSelectedPathsChange={(paths) => {
                  setContentState((current) => ({ ...current, selectedPaths: paths }));
                }}
                selectedPaths={selectedPaths}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
