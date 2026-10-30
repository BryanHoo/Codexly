import { ProjectFileMutationDialog, type ProjectFileRenameProps, type ProjectFileDeleteProps } from "@codexly/ui/core/project-file-mutation";
import { getProjectFileMutationMessages } from "@codexly/ui/core/project-file-creation-labels";
import { useTranslation } from "../../../i18n/i18n.js";

export function ProjectFileRenameDialog(props: ProjectFileRenameProps) {
  const { t, i18n } = useTranslation("workbench");
  return <ProjectFileMutationDialog {...props} labels={{ ...getProjectFileMutationMessages(i18n.resolvedLanguage), title: t("projectFile.renameTitle"), description: t(`projectFile.renameDescription.${props.targetType}`), name: t("projectFile.name"), submit: t("openMenu.rename"), cancel: t("actions.cancel"), close: t("actions.close") }} />;
}
export function ProjectFileDeleteDialog(props: ProjectFileDeleteProps) {
  const { t, i18n } = useTranslation("workbench");
  return <ProjectFileMutationDialog {...props} labels={{ ...getProjectFileMutationMessages(i18n.resolvedLanguage), title: t("projectFile.deleteTitle", { name: props.name }), description: t(`projectFile.deleteDescription.${props.targetType}`), name: t("projectFile.name"), submit: t("openMenu.delete"), cancel: t("actions.cancel"), close: t("actions.close") }} />;
}
