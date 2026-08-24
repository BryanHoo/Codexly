import type {
  AgentProvider,
  AgentRuntimeProvider,
  AgentTaskScope,
  ProjectRepository,
} from "@code-agent/core";
import { TEMPORARY_TASK_SCOPE_ID } from "@code-agent/protocol";

export type ResolvedTaskScope = Readonly<{
  provider: AgentProvider;
  scope: AgentTaskScope;
}>;

export async function resolveTaskScope(
  projectId: string,
  options: Readonly<{
    projectRepository: ProjectRepository;
    provider: AgentRuntimeProvider;
    temporaryWorkspace: string;
  }>,
): Promise<ResolvedTaskScope | undefined> {
  if (projectId === TEMPORARY_TASK_SCOPE_ID) {
    return {
      provider: options.provider.forTemporary(options.temporaryWorkspace),
      scope: {
        id: TEMPORARY_TASK_SCOPE_ID,
        kind: "temporary",
        rootPath: options.temporaryWorkspace,
        runtimeWorkspaceRoots: [options.temporaryWorkspace],
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
