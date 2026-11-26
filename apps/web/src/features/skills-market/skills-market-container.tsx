import { AcpExtensionNotice } from "@codexly/ui/core/acp-extension-notice";
import { useProjectData } from "../projects/project-context.js";
import { useTranslation } from "../../i18n/i18n.js";

export function SkillsMarketContainer() {
  const { t, i18n } = useTranslation("workbench");
  const { capabilities } = useProjectData();
  return (
    <AcpExtensionNotice
      pending={capabilities === undefined}
      language={i18n.language}
      title={t("skillsMarket.title")}
    />
  );
}
