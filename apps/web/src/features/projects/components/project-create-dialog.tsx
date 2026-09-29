import { isValidProjectDirectoryName } from "@codexly/protocol";
import { v4 as createUuid } from "uuid";
import { NewProjectDialog, type NewProjectClient } from "@codexly/ui/core/new-project-dialog";
import { useTranslation } from "../../../i18n/i18n.js";
import { ProjectDirectoryPickerDialog } from "./project-directory-picker-dialog.js";
import type { ComponentProps } from "react";

interface Props {
  client: NewProjectClient & ComponentProps<typeof ProjectDirectoryPickerDialog>["client"];
  onAdd: (paths: readonly string[]) => Promise<boolean>;
  onClose: () => void;
}

export function ProjectCreateDialog({ client, onAdd, onClose }: Props) {
  const { t } = useTranslation("workbench");
  const hostLabel = t("newProject.host", {
    host: typeof location === "undefined" ? "Codexly" : location.host,
  });
  return (
    <NewProjectDialog
      client={client}
      labels={{
        title: t("newProject.title"),
        parent: t("newProject.parent"),
        name: t("newProject.name"),
        path: t("newProject.path"),
        choose: t("newProject.choose"),
        cancel: t("newProject.cancel"),
        create: t("newProject.create"),
        creating: t("newProject.creating"),
        invalidName: t("newProject.invalidName"),
        loadError: t("newProject.loadError"),
        createError: t("newProject.createError"),
        addError: t("newProject.addError"),
        existsDirectory: t("newProject.existsDirectory"),
        existsFile: t("newProject.existsFile"),
        addExisting: t("newProject.addExisting"),
        retryAdd: t("newProject.retryAdd"),
        retry: t("newProject.retry"),
        loading: t("newProject.loading"),
      }}
      createRequestId={createUuid}
      hostLabel={hostLabel}
      storageKey="codexly:web:new-project-parent:v1"
      validateName={isValidProjectDirectoryName}
      onAdd={onAdd}
      onClose={onClose}
      renderDirectoryPicker={({ initialPath, onSelect, onCancel }) => (
        <ProjectDirectoryPickerDialog
          client={client}
          initialPath={initialPath}
          mode="parent"
          hostLabel={hostLabel}
          isAdding={false}
          onAdd={(paths) => {
            if (paths[0]) onSelect(paths[0]);
          }}
          onClose={onCancel}
        />
      )}
    />
  );
}
