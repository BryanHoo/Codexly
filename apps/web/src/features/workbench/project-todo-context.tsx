import {
  useEffect,
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { codexlyClient } from "../projects/project-queries.js";
import { notifyActionError } from "../notifications/action-notifications.js";
import { getSafeLocalStorage } from "../../shared/lib/browser-storage.js";
import { i18n } from "../../i18n/i18n.js";
import { createLegacyTodoImporter } from "./project-todo-import.js";

import {
  createProjectTodoStore,
  type ProjectTodoRecord,
  type ProjectTodoStore,
} from "./project-todo-store.js";

export type ProjectTodoItem = Readonly<{ projectId: string; record: ProjectTodoRecord }>;
const ProjectTodoContext = createContext<ProjectTodoStore | undefined>(undefined);

export function ProjectTodoProvider({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = useQueryClient();
  const storeRef = useRef<ProjectTodoStore>(null);
  storeRef.current ??= createProjectTodoStore({
    client: codexlyClient,
    queryClient,
    prepareProject: createLegacyTodoImporter(codexlyClient, getSafeLocalStorage(), () => {
      notifyActionError(i18n.t("composer.todoMigrationError", { ns: "workbench" }));
    }),
  });
  return (
    <ProjectTodoContext.Provider value={storeRef.current}>{children}</ProjectTodoContext.Provider>
  );
}

export function useProjectTodoStore(): ProjectTodoStore {
  const store = useContext(ProjectTodoContext);
  if (store === undefined)
    throw new Error("useProjectTodoStore must be used inside ProjectTodoProvider");
  return store;
}

export function useProjectTodos(projectId: string) {
  const store = useProjectTodoStore();
  const getSnapshot = useCallback(() => store.list(projectId), [projectId, store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function useProjectTodoQuery(projectId: string) {
  const store = useProjectTodoStore();
  const query = useQuery({
    ...store.queryOptions(projectId),
    enabled: projectId !== TEMPORARY_TASK_SCOPE_ID,
  });
  useEffect(() => {
    if (query.error !== null) notifyActionError(query.error);
  }, [query.error]);
  return query;
}

export function useAllProjectTodos(projectIds: readonly string[]): readonly ProjectTodoItem[] {
  const store = useProjectTodoStore();
  const queries = useQueries({
    queries: projectIds.map((id) => store.queryOptions(id)),
  });
  const error = queries.find((query) => query.error !== null)?.error;
  useEffect(() => {
    if (error !== undefined) notifyActionError(error);
  }, [error]);
  useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision);
  return projectIds.flatMap((projectId) =>
    store.list(projectId).map((record) => ({ projectId, record })),
  );
}
