import type { Project, ProjectRoot } from "@codexly/protocol";

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

export { setProjectRootPathChecked } from "@codexly/frontend-core";
