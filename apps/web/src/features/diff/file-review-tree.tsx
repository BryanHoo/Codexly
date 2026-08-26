import { FileCode2 } from "lucide-react";
import { useMemo } from "react";

import { FileTree, FileTreeFile, FileTreeFolder } from "../../shared/components/agent/file-tree.js";
import { useTranslation } from "../../i18n/i18n.js";
import type { AgentFileChange } from "./file-change.js";
import { countFileChangeLines } from "./file-change.js";
import type { FileNavigationViewMode } from "./file-navigation-view-preference.js";

export type ReviewFileTreeFile = Readonly<{
  additions: number;
  changeIndex: number;
  name: string;
  path: string;
  removals: number;
  type: "file";
}>;

export type ReviewFileTreeFolder = Readonly<{
  children: readonly ReviewFileTreeNode[];
  name: string;
  path: string;
  type: "folder";
}>;

export type ReviewFileTreeNode = ReviewFileTreeFile | ReviewFileTreeFolder;

interface MutableReviewDirectory {
  directories: Map<string, MutableReviewDirectory>;
  files: ReviewFileTreeFile[];
  name: string;
  path: string;
}

function compareReviewTreeNames(
  left: Pick<ReviewFileTreeNode, "name">,
  right: Pick<ReviewFileTreeNode, "name">,
): number {
  return left.name.localeCompare(right.name, "en");
}

function buildReviewFileTreeFolder(directory: MutableReviewDirectory): ReviewFileTreeFolder {
  const compactNames = [directory.name];
  let compactDirectory = directory;

  // 没有直接文件和同级分支的目录不单独占一行，直到真正的内容层级才展开。
  while (compactDirectory.files.length === 0 && compactDirectory.directories.size === 1) {
    const child = compactDirectory.directories.values().next().value;
    if (child === undefined) {
      break;
    }
    compactNames.push(child.name);
    compactDirectory = child;
  }

  const directories = [...compactDirectory.directories.values()]
    .sort(compareReviewTreeNames)
    .map(buildReviewFileTreeFolder);
  const files = compactDirectory.files.toSorted(compareReviewTreeNames);
  return {
    children: [...directories, ...files],
    name: compactNames.join("/"),
    path: compactDirectory.path,
    type: "folder",
  };
}

export function buildReviewFileTree(
  changes: readonly AgentFileChange[],
): readonly ReviewFileTreeNode[] {
  const root: MutableReviewDirectory = {
    directories: new Map(),
    files: [],
    name: "",
    path: "",
  };

  changes.forEach((change, changeIndex) => {
    const segments = change.path.split(/[\\/]/);
    const name = segments.at(-1) ?? change.path;
    let directory = root;
    let directoryPath = "";

    for (const segment of segments.slice(0, -1)) {
      directoryPath = directoryPath.length === 0 ? segment : `${directoryPath}/${segment}`;
      let child = directory.directories.get(segment);
      if (child === undefined) {
        child = { directories: new Map(), files: [], name: segment, path: directoryPath };
        directory.directories.set(segment, child);
      }
      directory = child;
    }

    const { additions, removals } = countFileChangeLines(change);
    directory.files.push({
      additions,
      changeIndex,
      name,
      path: segments.join("/"),
      removals,
      type: "file",
    });
  });

  return [
    ...[...root.directories.values()].sort(compareReviewTreeNames).map(buildReviewFileTreeFolder),
    ...root.files.toSorted(compareReviewTreeNames),
  ];
}

function collectReviewFileTreeFolderPaths(
  nodes: readonly ReviewFileTreeNode[],
  paths = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.type === "folder") {
      paths.add(node.path);
      collectReviewFileTreeFolderPaths(node.children, paths);
    }
  }
  return paths;
}

function collectReviewFiles(
  nodes: readonly ReviewFileTreeNode[],
  files: ReviewFileTreeFile[] = [],
): readonly ReviewFileTreeFile[] {
  for (const node of nodes) {
    if (node.type === "folder") {
      collectReviewFiles(node.children, files);
    } else {
      files.push(node);
    }
  }
  return files;
}

function ReviewFileTreeNodes({
  fileLabel,
  nodes,
  showStats,
}: Readonly<{
  fileLabel: (node: ReviewFileTreeFile) => string;
  nodes: readonly ReviewFileTreeNode[];
  showStats: boolean;
}>) {
  return nodes.map((node) =>
    node.type === "folder" ? (
      <FileTreeFolder key={node.path} name={node.name} path={node.path}>
        <ReviewFileTreeNodes fileLabel={fileLabel} nodes={node.children} showStats={showStats} />
      </FileTreeFolder>
    ) : (
      <FileTreeFile
        aria-label={fileLabel(node)}
        icon={<FileCode2 aria-hidden="true" className="size-3.5 text-muted-foreground" />}
        key={`${node.path}:${String(node.changeIndex)}`}
        name={node.name}
        path={node.path}
        trailing={
          showStats ? (
            <span aria-hidden="true" className="ml-auto flex shrink-0 items-center gap-1 text-meta">
              <span className="font-medium text-diff-added">+{node.additions}</span>
              <span className="font-medium text-diff-removed">-{node.removals}</span>
            </span>
          ) : undefined
        }
      />
    ),
  );
}

export function ReviewFileTreeNavigation({
  nodes,
  onSelect,
  selectedPath,
  showStats = true,
  viewMode = "tree",
}: Readonly<{
  nodes: readonly ReviewFileTreeNode[];
  onSelect: (path: string) => void;
  selectedPath: string;
  showStats?: boolean;
  viewMode?: FileNavigationViewMode;
}>) {
  const { t } = useTranslation("workbench");
  const defaultExpanded = useMemo(() => collectReviewFileTreeFolderPaths(nodes), [nodes]);
  const files = useMemo(() => collectReviewFiles(nodes), [nodes]);
  const fileLabel = (node: ReviewFileTreeFile) =>
    showStats
      ? t("diff.fileStats", {
          additions: node.additions,
          path: node.path,
          removals: node.removals,
        })
      : node.path;

  if (viewMode === "list") {
    return (
      <div
        aria-label={t("diff.changedFilesNavigation")}
        className="font-mono text-label"
        data-slot="review-file-list"
        role="listbox"
      >
        {files.map((file) => (
          <button
            aria-label={fileLabel(file)}
            aria-selected={file.path === selectedPath}
            className="flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-control px-1.5 text-left outline-none transition-colors hover:bg-control-hover focus-visible:shadow-focus aria-selected:bg-control"
            key={`${file.path}:${String(file.changeIndex)}`}
            onClick={() => {
              onSelect(file.path);
            }}
            role="option"
            type="button"
          >
            <FileCode2 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={file.path}>
              {file.path}
            </span>
            {showStats ? (
              <span aria-hidden="true" className="flex shrink-0 items-center gap-1 text-meta">
                <span className="font-medium text-diff-added">+{file.additions}</span>
                <span className="font-medium text-diff-removed">-{file.removals}</span>
              </span>
            ) : null}
          </button>
        ))}
      </div>
    );
  }

  return (
    <FileTree
      aria-label={t("diff.changedFilesNavigation")}
      defaultExpanded={defaultExpanded}
      onSelect={onSelect}
      selectedPath={selectedPath}
    >
      <ReviewFileTreeNodes fileLabel={fileLabel} nodes={nodes} showStats={showStats} />
    </FileTree>
  );
}
