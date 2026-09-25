import type { ProjectGitStatus } from "@/protocol/index.js";

export type CommitChange = ProjectGitStatus["staged"][number];

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

