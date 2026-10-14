import type { PushProjectCommitsRequest } from "@codexly/protocol";
import { useMemo } from "react";
import { GitCommitWorkspace } from "@codexly/ui/core/git-commit-workspace";
import type {
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  PushProjectCommitsResponse,
  GenerateCommitMessageRequest,
  ProjectGitStatus,
} from "@codexly/protocol";
import { useTranslation } from "../../../i18n/i18n.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { useFileNavigationViewPreference } from "../../diff/file-navigation-view-preference.js";
import { CommitChangesTreeSection } from "./commit-changes-tree.js";

export { collectCommitFileEntries } from "@codexly/ui/core/git-commit-workspace";

type CommitChangesPanelProps = Readonly<{
  error?: Error | null;
  gitStatus: ProjectGitStatus;
  draftScope?: string;
  isCommitting?: boolean;
  isPushing?: boolean;
  isGenerating?: boolean;
  activeRemoteAction?: PushProjectCommitsRequest["action"] | null | undefined;
  onPush: () => Promise<void>;
  onRemoteAction?: (request: Omit<PushProjectCommitsRequest, "expectedSnapshot">) => Promise<void>;
  remoteResult?: PushProjectCommitsResponse | undefined;
  isInspectingRemote?: boolean;
  onCommit: (request: CommitProjectChangesRequest) => Promise<void>;
  onGenerateMessage: (request: GenerateCommitMessageRequest) => Promise<string>;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenProjectFile?: ((path: string) => void) | undefined;
  result?: CommitProjectChangesResponse | null;
  pushResult?: PushProjectCommitsResponse | null;
}>;

export function CommitChangesPanel(props: CommitChangesPanelProps) {
  const { gitStatus, onOpenFileDiff } = props;
  const { t } = useTranslation("workbench");
  const [fileViewMode, setFileViewMode] = useFileNavigationViewPreference("changes");
  const changes = useMemo(() => {
    // 暂存条目优先，每个文件仅展示一次，预览与实际提交使用相同版本。
    const byPath = new Map(gitStatus.staged.map((change) => [change.path, change]));
    for (const change of gitStatus.unstaged)
      if (!byPath.has(change.path)) byPath.set(change.path, change);
    return [...byPath.values()];
  }, [gitStatus]);
  const scope = JSON.stringify([props.draftScope ?? "repository", gitStatus.branch]);
  return (
    <GitCommitWorkspace
      key={scope}
      {...props}
      draftScope={scope}
      onOpenConflict={props.onOpenProjectFile}
      t={(key, values) => t(key, values ?? {})}
      viewMode={fileViewMode}
      onViewModeChange={setFileViewMode}
      renderChanges={(selected, onChange, disabled, search) => {
        const filtered = search
          ? changes.filter((change) => change.path.toLowerCase().includes(search.toLowerCase()))
          : changes;
        if (search && filtered.length === 0)
          return (
            <p className="p-3 text-caption text-muted-foreground">{t("commit.noMatchingFiles")}</p>
          );
        return (
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            data-slot="commit-changes-scroll"
          >
            <CommitChangesTreeSection
              changes={filtered}
              label={t("commit.changes")}
              disabled={disabled}
              onOpenFileDiff={onOpenFileDiff}
              onSelectedPathsChange={onChange}
              selectedPaths={selected}
              viewMode={fileViewMode}
            />
          </div>
        );
      }}
    />
  );
}
