import { Check, FolderGit2, GitBranch, Plus, Search } from "lucide-react";
import * as Tabs from "radix-ui/tabs";
import { useRef, useState } from "react";
import {
  buildComposerGitPicker,
  formatComposerWorkspacePath,
} from "@codexly/frontend-core/composer-git-picker";
import type { ProjectGitWorktree } from "@codexly/protocol";
import type { ComposerGitLabels } from "./composer-git-contracts.js";
import { Button } from "./button.js";
import { Input } from "./input.js";

type PickerProps = Readonly<{
  labels: ComposerGitLabels;
  branches: readonly string[];
  branch: string | null;
  rootPath: string | undefined;
  worktrees: readonly ProjectGitWorktree[] | undefined;
  hasWorkspace: boolean;
  error: boolean;
  pending: boolean;
  onRetry: () => void;
  onSelectWorktree: (path: string) => void;
  onSelectBranch: (branch: string) => void;
  onCreate: (kind: "branch" | "worktree", initialBranch: string) => void;
}>;

/** 分支表示同一目录内的检出，工作树表示独立目录；视图与创建入口一一对应。 */
export function ComposerGitPicker(props: PickerProps) {
  const { labels } = props;
  const [view, setView] = useState<"branch" | "worktree">("branch");
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const mainPath = props.worktrees?.[0]?.path;
  const model = buildComposerGitPicker(
    props.branches,
    props.branch,
    props.worktrees ?? [],
    props.rootPath,
    query,
  );
  const worktreeView = view === "worktree";
  const items = worktreeView
    ? model.worktrees.map((item) => ({
        value: item.path,
        title: item.branch ?? labels.missing,
        description: formatComposerWorkspacePath(item.path, mainPath),
        selected: item.selected,
        disabled: props.pending,
        badge: item.main ? labels.mainWorktree : undefined,
        fullPath: item.path,
      }))
    : model.branches.map((item) => ({
        value: item.name,
        title: item.name,
        description: item.occupiedPath
          ? formatComposerWorkspacePath(item.occupiedPath, mainPath)
          : undefined,
        selected: item.selected,
        disabled: props.pending || item.occupiedPath !== undefined,
        badge: item.occupiedPath ? labels.occupied : undefined,
        fullPath: item.occupiedPath,
      }));
  const selectedIndex = items.findIndex((item) => item.selected && !item.disabled);
  const tabStop = selectedIndex >= 0 ? selectedIndex : items.findIndex((item) => !item.disabled);
  const searchLabel = worktreeView ? labels.searchWorktrees : labels.searchBranches;
  const Icon = worktreeView ? FolderGit2 : GitBranch;
  const loading = worktreeView && props.worktrees === undefined && !props.error;
  return (
    <>
      <div className="border-b border-separator px-3 py-2">
        <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <span>{labels.current}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate" title={props.rootPath}>
            {props.rootPath
              ? formatComposerWorkspacePath(props.rootPath, mainPath)
              : labels.branches}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-label font-medium">
          <GitBranch aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate" title={props.branch ?? undefined}>
            {props.branch ?? labels.missing}
          </span>
        </div>
      </div>
      {/* 桌面保持紧凑密度，触屏只扩大点击高度，不放大字号与图标。 */}
      <Tabs.Root
        value={view}
        onValueChange={(value) => {
          setView(value === "worktree" ? "worktree" : "branch");
          setQuery("");
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List
          aria-label={labels.pickerTitle}
          className="mx-2 mt-2 flex shrink-0 gap-0.5 rounded-control bg-control p-0.5"
        >
          {(props.hasWorkspace ? (["branch", "worktree"] as const) : (["branch"] as const)).map(
            (kind) => (
              <Tabs.Trigger
                key={kind}
                value={kind}
                className="flex min-h-6 flex-1 items-center justify-center gap-1.5 rounded-control px-2 text-meta pointer-coarse:min-h-8 text-muted-foreground outline-none focus-visible:shadow-focus data-[state=active]:bg-raised data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                {kind === "worktree" ? labels.worktrees : labels.branches}
                <span className="text-meta tabular-nums text-subtle-foreground">
                  {kind === "worktree" ? (props.worktrees?.length ?? "–") : props.branches.length}
                </span>
              </Tabs.Trigger>
            ),
          )}
        </Tabs.List>
        <Tabs.Content value={view} className="flex min-h-0 flex-1 flex-col outline-none">
          <p className="px-3 py-1.5 text-caption text-muted-foreground">
            {worktreeView ? labels.worktreeHint : labels.branchHint}
          </p>
          <div className="relative mx-2 mb-1.5 shrink-0">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label={searchLabel}
              type="search"
              variant="outline"
              className="h-7 pl-6.5 text-meta sm:h-7 pointer-coarse:h-9"
              placeholder={searchLabel}
              value={query}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                const options = listRef.current?.querySelectorAll<HTMLButtonElement>(
                  '[role="option"]:not(:disabled)',
                );
                const target =
                  event.key === "ArrowDown" ? options?.[0] : options?.[options.length - 1];
                if (target) {
                  event.preventDefault();
                  target.focus();
                }
              }}
            />
          </div>
          {loading || (worktreeView && props.error) ? (
            <div
              className="grid min-h-20 place-content-center gap-1.5 px-3 py-4 text-center text-caption text-muted-foreground"
              role="status"
            >
              {loading ? (
                labels.loading
              ) : (
                <>
                  {labels.loadError}
                  <Button variant="link" onClick={props.onRetry}>
                    {labels.retry}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div
              ref={listRef}
              role="listbox"
              aria-label={worktreeView ? labels.worktrees : labels.branches}
              aria-busy={props.pending}
              className="min-h-0 overflow-y-auto overscroll-contain px-1 pb-1"
              onKeyDown={(event) => {
                // 方向键只移动焦点，Enter/空格才执行 Git 操作，避免浏览列表时意外切换目录或分支。
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                const options = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="option"]:not(:disabled)',
                  ),
                ];
                if (options.length === 0) return;
                const index = options.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? options.length - 1
                      : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
                        options.length;
                event.preventDefault();
                options[next]?.focus();
              }}
            >
              {items.length === 0 ? (
                <p
                  role="status"
                  className="px-2 py-4 text-center text-caption text-muted-foreground"
                >
                  {labels.noResults}
                </p>
              ) : (
                items.map((item, index) => (
                  <button
                    key={item.value}
                    role="option"
                    aria-selected={item.selected}
                    aria-label={item.title}
                    aria-description={
                      [item.badge, item.fullPath].filter(Boolean).join(" · ") || undefined
                    }
                    type="button"
                    disabled={item.disabled}
                    title={item.fullPath ?? item.title}
                    tabIndex={index === tabStop ? 0 : -1}
                    className="flex min-h-7 w-full items-center gap-2 rounded-control px-2 py-1 text-left text-label pointer-coarse:min-h-10 outline-none hover:bg-control-hover focus-visible:bg-control-hover focus-visible:shadow-focus disabled:opacity-50 aria-selected:bg-control"
                    onClick={() => {
                      if (!item.selected)
                        (worktreeView ? props.onSelectWorktree : props.onSelectBranch)(item.value);
                    }}
                  >
                    <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate">{item.title}</span>
                      {item.description ? (
                        <span className="truncate font-mono text-caption text-muted-foreground">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {item.badge ? (
                      <span className="shrink-0 rounded border border-separator px-1 py-0 text-caption text-muted-foreground">
                        {item.badge}
                      </span>
                    ) : null}
                    {item.selected ? (
                      <Check
                        aria-label={labels.current}
                        className="size-3 shrink-0 text-foreground"
                      />
                    ) : null}
                  </button>
                ))
              )}
            </div>
          )}
          <div className="mt-auto shrink-0 border-t border-separator p-1">
            <Button
              aria-label={worktreeView ? labels.createWorktree : labels.createBranch}
              variant="ghost"
              size="embedded"
              disabled={props.pending || (worktreeView && props.worktrees === undefined)}
              className="min-h-7 w-full justify-start gap-2 rounded-control px-2 py-1 text-label text-foreground pointer-coarse:min-h-10"
              onClick={() => {
                props.onCreate(view, query.trim());
              }}
            >
              <Plus aria-hidden="true" className="size-3.5" />
              <span>{worktreeView ? labels.createWorktree : labels.createBranch}</span>
            </Button>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}
