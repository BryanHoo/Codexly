import type { Project, ProjectRoot } from "@code-agent/protocol";

export type ProjectRootSelection = Readonly<{
  projectId: string;
  rootId: string;
}>;

/** 按 Project 身份和 roots 成员关系派生当前根，失效选择直接回退 primary。 */
export function resolveSelectedProjectRoot(
  project: Pick<Project, "id" | "roots"> | undefined,
  selection: ProjectRootSelection | undefined,
): ProjectRoot | undefined {
  if (project === undefined) return undefined;
  return (
    project.roots.find(
      (root) => selection?.projectId === project.id && root.id === selection.rootId,
    ) ?? project.roots[0]
  );
}

export function resolveProjectRootFromSelections(
  project: Pick<Project, "id" | "roots"> | undefined,
  selectedRootIds: ReadonlyMap<string, string>,
): ProjectRoot | undefined {
  if (project === undefined) return undefined;
  const rootId = selectedRootIds.get(project.id);
  return resolveSelectedProjectRoot(
    project,
    rootId === undefined ? undefined : { projectId: project.id, rootId },
  );
}

/** 按 checkbox 的明确状态更新根目录，并保留首次勾选顺序。 */
export function setProjectRootPathChecked(
  paths: readonly string[],
  path: string,
  checked: boolean,
): readonly string[] {
  if (checked) return paths.includes(path) ? paths : [...paths, path];
  return paths.filter((selectedPath) => selectedPath !== path);
}
