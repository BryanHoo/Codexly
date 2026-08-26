import type { ProjectGitStatus } from "@codexly/protocol";
import { FileMinus2, FilePenLine, FilePlus2 } from "lucide-react";
import { useMemo, type MouseEvent } from "react";

import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
  FileTreeIcon,
  FileTreeName,
} from "../../../shared/components/agent/file-tree.js";
import { cn } from "../../../shared/lib/utils.js";
import { Checkbox } from "../../../shared/components/core/checkbox.js";
import type { FileNavigationViewMode } from "../../diff/file-navigation-view-preference.js";

type CommitChange = ProjectGitStatus["staged"][number];

export type CommitChangeTreeNode =
  | Readonly<{
      children: readonly CommitChangeTreeNode[];
      kind: "folder";
      name: string;
      path: string;
    }>
  | Readonly<{
      kind: "file";
      name: string;
      path: string;
      status: CommitChange["kind"];
    }>;

type CommitChangeFileNode = Extract<CommitChangeTreeNode, Readonly<{ kind: "file" }>>;

interface MutableFolder {
  children: Map<string, MutableFolder | CommitChangeFileNode>;
  kind: "folder";
  name: string;
  path: string;
}

function sortTreeNodes(nodes: readonly CommitChangeTreeNode[]): readonly CommitChangeTreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "file" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "en");
  });
}

function freezeFolder(folder: MutableFolder): CommitChangeTreeNode {
  const compactNames = [folder.name];
  let compactFolder = folder;

  // 与审核树一致：没有直接文件或同级分支的连续目录合并为一个路径节点。
  while (compactFolder.children.size === 1) {
    const child = compactFolder.children.values().next().value;
    if (child?.kind !== "folder") {
      break;
    }
    compactNames.push(child.name);
    compactFolder = child;
  }

  return {
    children: sortTreeNodes(
      [...compactFolder.children.values()].map((child) =>
        child.kind === "folder" ? freezeFolder(child) : child,
      ),
    ),
    kind: "folder",
    name: compactNames.join("/"),
    path: compactFolder.path,
  };
}

export function buildCommitChangeTree(
  changes: readonly CommitChange[],
): readonly CommitChangeTreeNode[] {
  const root: MutableFolder = { children: new Map(), kind: "folder", name: "", path: "" };

  for (const change of changes) {
    const segments = change.path.split("/");
    const fileName = segments.pop();
    if (fileName === undefined) {
      continue;
    }
    let parent = root;
    for (const segment of segments) {
      const path = parent.path === "" ? segment : `${parent.path}/${segment}`;
      const current = parent.children.get(segment);
      if (current?.kind === "folder") {
        parent = current;
        continue;
      }
      const folder: MutableFolder = { children: new Map(), kind: "folder", name: segment, path };
      parent.children.set(segment, folder);
      parent = folder;
    }
    parent.children.set(fileName, {
      kind: "file",
      name: fileName,
      path: change.path,
      status: change.kind,
    });
  }

  return sortTreeNodes(
    [...root.children.values()].map((child) =>
      child.kind === "folder" ? freezeFolder(child) : child,
    ),
  );
}

function collectFolderPaths(nodes: readonly CommitChangeTreeNode[], paths: Set<string>) {
  for (const node of nodes) {
    if (node.kind !== "folder") {
      continue;
    }
    paths.add(node.path);
    collectFolderPaths(node.children, paths);
  }
}

function statusToneClassName(status: CommitChange["kind"]): string {
  if (status === "create") return "text-diff-added";
  if (status === "delete") return "text-danger";
  return "text-warning";
}

function statusIcon(status: CommitChange["kind"]) {
  const className = cn("size-3.5", statusToneClassName(status));
  if (status === "create") {
    return <FilePlus2 aria-hidden="true" className={className} />;
  }
  if (status === "delete") {
    return <FileMinus2 aria-hidden="true" className={className} />;
  }
  return <FilePenLine aria-hidden="true" className={className} />;
}

function statusLetter(status: CommitChange["kind"]): string {
  if (status === "create") return "A";
  if (status === "delete") return "D";
  return "M";
}

type CommitTreeNodesProps = Readonly<{
  changesByPath: ReadonlyMap<string, CommitChange>;
  disabled: boolean;
  label: string;
  nodes: readonly CommitChangeTreeNode[];
  onOpenFileDiff: (change: CommitChange) => void;
  onTogglePath: (path: string) => void;
  selectedPaths: ReadonlySet<string>;
}>;

function CommitTreeNodes({
  changesByPath,
  disabled,
  label,
  nodes,
  onOpenFileDiff,
  onTogglePath,
  selectedPaths,
}: CommitTreeNodesProps) {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return (
        <FileTreeFolder key={node.path} name={node.name} path={node.path}>
          <CommitTreeNodes
            changesByPath={changesByPath}
            disabled={disabled}
            label={label}
            nodes={node.children}
            onOpenFileDiff={onOpenFileDiff}
            onTogglePath={onTogglePath}
            selectedPaths={selectedPaths}
          />
        </FileTreeFolder>
      );
    }

    const checked = selectedPaths.has(node.path);
    const change = changesByPath.get(node.path);
    const stopRowToggle = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    };
    return (
      <FileTreeFile
        aria-label={node.path}
        className={statusToneClassName(node.status)}
        icon={statusIcon(node.status)}
        key={node.path}
        name={node.name}
        onClick={() => {
          if (change !== undefined) onOpenFileDiff(change);
        }}
        path={node.path}
        trailing={
          <span className="ml-auto w-3 text-center text-meta font-semibold text-muted-foreground">
            {statusLetter(node.status)}
          </span>
        }
      >
        <span aria-hidden="true" className="size-5 shrink-0" />
        {/* 文件行负责预览，只有左侧复选框改变提交选择。 */}
        <Checkbox
          aria-label={`${label}: ${node.path}`}
          checked={checked}
          disabled={disabled}
          onCheckedChange={() => {
            onTogglePath(node.path);
          }}
          onClick={stopRowToggle}
        />
        <FileTreeIcon>{statusIcon(node.status)}</FileTreeIcon>
        <FileTreeName title={node.path}>{node.name}</FileTreeName>
      </FileTreeFile>
    );
  });
}

type CommitChangesTreeSectionProps = Readonly<{
  changes: readonly CommitChange[];
  disabled?: boolean;
  label: string;
  onOpenFileDiff: (change: CommitChange) => void;
  onSelectedPathsChange: (paths: Set<string>) => void;
  selectedPaths: ReadonlySet<string>;
  viewMode?: FileNavigationViewMode;
}>;

export function CommitChangesTreeSection({
  changes,
  disabled = false,
  label,
  onOpenFileDiff,
  onSelectedPathsChange,
  selectedPaths,
  viewMode = "tree",
}: CommitChangesTreeSectionProps) {
  const nodes = useMemo(() => buildCommitChangeTree(changes), [changes]);
  const changesByPath = useMemo(
    () => new Map(changes.map((change) => [change.path, change])),
    [changes],
  );
  const paths = useMemo(() => [...new Set(changes.map((change) => change.path))], [changes]);
  const defaultExpanded = useMemo(() => {
    const expanded = new Set<string>();
    collectFolderPaths(nodes, expanded);
    return expanded;
  }, [nodes]);
  if (paths.length === 0) return null;

  const selectedCount = paths.filter((path) => selectedPaths.has(path)).length;
  const checked =
    selectedCount === 0 ? false : selectedCount === paths.length ? true : "indeterminate";

  const togglePath = (path: string) => {
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onSelectedPathsChange(next);
  };

  return (
    <section aria-label={label} className="py-0.5">
      <div className="flex min-h-7 items-center gap-1.5 px-3">
        <Checkbox
          aria-label={label}
          checked={checked}
          disabled={disabled || paths.length === 0}
          onCheckedChange={(nextChecked) => {
            const next = new Set(selectedPaths);
            for (const path of paths) {
              if (nextChecked === true) next.add(path);
              else next.delete(path);
            }
            onSelectedPathsChange(next);
          }}
        />
        <h3 className="text-label font-semibold text-foreground">{label}</h3>
        <span className="ml-auto text-caption text-muted-foreground">{paths.length}</span>
      </div>
      {viewMode === "list" ? (
        <div className="px-1 font-mono text-label" data-slot="commit-changes-list" role="list">
          {changes
            .toSorted((left, right) => left.path.localeCompare(right.path, "en"))
            .map((change) => (
              <div
                className="flex min-h-7 items-center gap-1.5 rounded-control px-2 hover:bg-control-hover"
                key={change.path}
                role="listitem"
              >
                <Checkbox
                  aria-label={`${label}: ${change.path}`}
                  checked={selectedPaths.has(change.path)}
                  disabled={disabled}
                  onCheckedChange={() => {
                    togglePath(change.path);
                  }}
                />
                <button
                  aria-label={change.path}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:shadow-focus",
                    statusToneClassName(change.kind),
                  )}
                  onClick={() => {
                    onOpenFileDiff(change);
                  }}
                  type="button"
                >
                  {statusIcon(change.kind)}
                  <span className="min-w-0 flex-1 truncate" title={change.path}>
                    {change.path}
                  </span>
                  <span className="w-3 text-center text-meta font-semibold text-muted-foreground">
                    {statusLetter(change.kind)}
                  </span>
                </button>
              </div>
            ))}
        </div>
      ) : nodes.length === 0 ? null : (
        <FileTree aria-label={label} className="px-1" defaultExpanded={defaultExpanded}>
          <CommitTreeNodes
            changesByPath={changesByPath}
            disabled={disabled}
            label={label}
            nodes={nodes}
            onOpenFileDiff={onOpenFileDiff}
            onTogglePath={togglePath}
            selectedPaths={selectedPaths}
          />
        </FileTree>
      )}
    </section>
  );
}
