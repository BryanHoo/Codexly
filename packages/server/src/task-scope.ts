import type {
  AgentProvider,
  AgentRuntimeProvider,
  AgentTaskScope,
  ProjectRepository,
} from "@codexly/core";
import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";

export type ResolvedTaskScope = Readonly<{
  provider: AgentProvider;
  scope: AgentTaskScope;
}>;

export async function resolveTaskScope(
  projectId: string,
  options: Readonly<{
    projectRepository: ProjectRepository;
    provider: AgentRuntimeProvider;
    standaloneCwd: string;
  }>,
): Promise<ResolvedTaskScope | undefined> {
  if (projectId === TEMPORARY_TASK_SCOPE_ID) {
    return {
      provider: options.provider.forTemporary(options.standaloneCwd),
      scope: {
        id: TEMPORARY_TASK_SCOPE_ID,
        kind: "temporary",
        rootPath: options.standaloneCwd,
        runtimeWorkspaceRoots: [options.standaloneCwd],
      },
    };
  }

  const project = await options.projectRepository.read(projectId);
  if (project === undefined) return undefined;
  const primaryRoot = project.roots[0];
  if (primaryRoot === undefined) return undefined;
  return {
    provider: options.provider.forProject(project),
    scope: {
      id: project.id,
      kind: "project",
      rootPath: primaryRoot.path,
      runtimeWorkspaceRoots: project.roots.map((root) => root.path),
    },
  };
}
