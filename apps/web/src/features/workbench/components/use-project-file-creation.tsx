import { getProjectFileCreationMessages } from "@codexly/ui/core/project-file-creation-labels";
import { useProjectFileCreation as useSharedFileCreation } from "@codexly/ui/core/project-file-creation";
import type { CreateProjectFileResponse } from "@codexly/protocol";
import type { RefObject } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import type { CodexlyFileTreeClient } from "../../projects/project-query-contracts.js";

export function useProjectFileCreation({
  client,
  parentPath,
  projectId,
  projectPath,
  onCreated,
  returnFocus,
}: Readonly<{
  client: CodexlyFileTreeClient;
  parentPath: string | null;
  projectId: string;
  projectPath: string;
  onCreated: (result: CreateProjectFileResponse) => void;
  returnFocus: RefObject<HTMLElement | null>;
}>) {
  const { t, i18n } = useTranslation("workbench");
  return useSharedFileCreation({
    create: (input, options) => client.createProjectFile(projectId, projectPath, input, options),
    parentPath,
    onCreated,
    returnFocus,
    labels: {
      ...getProjectFileCreationMessages(i18n.resolvedLanguage, parentPath ?? projectPath),
      name: t("projectFile.name"),
      cancel: t("actions.cancel"),
      close: t("actions.close"),
    },
  });
}
