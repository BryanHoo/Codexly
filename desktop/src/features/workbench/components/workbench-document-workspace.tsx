import { describeWorkbenchDocument } from "@codexly/frontend-core/document-presentation";
import { DocumentWorkspace } from "@codexly/ui/core/document-workspace";
import type { ReactNode } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { WorkbenchInspectorDocument } from "./workbench-inspector-document.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";

export function WorkbenchDocumentWorkspace({ children, context, projectId, taskId, enabled }: Readonly<{
  children: ReactNode;
  context: ReturnType<typeof useWorkbenchShellController>;
  projectId: string;
  taskId?: string;
  enabled: boolean;
}>) {
  const { t, i18n } = useTranslation("workbench");
  return <DocumentWorkspace workspace={context.documentWorkspace} locale={i18n.language} enabled={enabled}
    describe={(document) => describeWorkbenchDocument(document, t("diff.reviewTitle"))}
    renderDocument={(document) => <WorkbenchInspectorDocument
      client={context.client} document={document} projectId={projectId}
      {...(context.selectedRootPath === undefined ? {} : { rootPath: context.selectedRootPath })}
      {...(taskId === undefined ? {} : { taskId })}
      loadDiff={context.loadProjectFileDiff}
      onClose={() => { void context.removeInspectorDocument(document.id); }} onOpenDiff={context.openFileDiff}
    />}>
    {children}
  </DocumentWorkspace>;
}
