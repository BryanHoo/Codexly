import { CodexSkillsPane } from "@codexly/ui/core/codex-resources-pane";
import { useTranslation } from "../../i18n/i18n.js";
import { useProjectData } from "../projects/project-context.js";

export function InstalledSkillsPane() {
  const {client} = useProjectData();
  const {t} = useTranslation("workbench");
  return <CodexSkillsPane client={client} t={(key, options) => t(key, options ?? {})} />;
}
