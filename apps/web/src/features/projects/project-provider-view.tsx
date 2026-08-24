import { TEMPORARY_TASK_SCOPE_ID, type Project } from "@code-agent/protocol";
import type { ReactNode } from "react";
import {
  ProjectActionsContext,
  ProjectActivityContext,
  ProjectDataContext,
  ProjectRootSelectionContext,
  ProjectTaskQuery,
  type ProjectActionsContextValue,
  type ProjectActivityContextValue,
  type ProjectDataContextValue,
  type ProjectRootSelectionContextValue,
  type ProjectTaskQueryResult,
} from "./project-context-state.js";
import type { CodeAgentWorkbenchClient } from "./project-queries.js";

type ProjectProviderViewProps = Readonly<{
  actions: ProjectActionsContextValue;
  activity: ProjectActivityContextValue;
  children: ReactNode;
  client: CodeAgentWorkbenchClient;
  data: ProjectDataContextValue;
  onRemoveTaskQuery: (projectId: string) => void;
  onUpdateTaskQuery: (projectId: string, result: ProjectTaskQueryResult) => void;
  projects: readonly Project[];
  rootSelection: ProjectRootSelectionContextValue;
}>;

// 将查询挂载与 Context 层级集中在稳定组件中，Provider 仅负责状态编排。
export function ProjectProviderView({
  actions,
  activity,
  children,
  client,
  data,
  onRemoveTaskQuery,
  onUpdateTaskQuery,
  projects,
  rootSelection,
}: ProjectProviderViewProps) {
  return (
    <>
      <ProjectTaskQuery
        client={client}
        onRemove={onRemoveTaskQuery}
        onUpdate={onUpdateTaskQuery}
        projectId={TEMPORARY_TASK_SCOPE_ID}
      />
      {projects.map((project) => (
        <ProjectTaskQuery
          client={client}
          key={project.id}
          onRemove={onRemoveTaskQuery}
          onUpdate={onUpdateTaskQuery}
          projectId={project.id}
        />
      ))}
      <ProjectDataContext.Provider value={data}>
        <ProjectActionsContext.Provider value={actions}>
          <ProjectRootSelectionContext.Provider value={rootSelection}>
            <ProjectActivityContext.Provider value={activity}>
              {children}
            </ProjectActivityContext.Provider>
          </ProjectRootSelectionContext.Provider>
        </ProjectActionsContext.Provider>
      </ProjectDataContext.Provider>
    </>
  );
}
