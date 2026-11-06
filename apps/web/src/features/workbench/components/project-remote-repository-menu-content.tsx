import { ProjectRemoteRepositoryMenuItem as SharedItem } from "@codexly/ui/core/project-remote-repository-menu-item";
import { codexlyClient } from "../../projects/project-query-contracts.js";
import { useTranslation } from "../../../i18n/i18n.js";
import type { RemoteRepositoryTarget } from "@codexly/ui/core/project-remote-repository-menu-item";

export default function ProjectRemoteRepositoryMenuContent(props: {
  target: RemoteRepositoryTarget;
  variant: "context" | "dropdown";
}) {
  const { t } = useTranslation("workbench");
  return (
    <SharedItem {...props} client={codexlyClient} label={t("openMenu.openRemoteRepository")} />
  );
}
