import { ProjectRemoteRepositoryMenuItem as SharedItem } from "@codexly/ui/core/project-remote-repository-menu-item";
import { nativeClient } from "../../projects/project-query-contracts.js";
import { useTranslation } from "../../../i18n/i18n.js";
import type { RemoteRepositoryTarget } from "@codexly/ui/core/project-remote-repository-menu-item";
import { openExternalUrl } from "../../../platform/tauri/external-url.js";
import { notifyActionError } from "../../notifications/action-notifications.js";

export default function ProjectRemoteRepositoryMenuContent(props: {
  target: RemoteRepositoryTarget;
  variant: "context" | "dropdown";
}) {
  const { t } = useTranslation("workbench");
  return (
    <SharedItem
      {...props}
      client={nativeClient}
      label={t("openMenu.openRemoteRepository")}
      onOpenUrl={(url) => {
        void openExternalUrl(url).catch(notifyActionError);
      }}
    />
  );
}
