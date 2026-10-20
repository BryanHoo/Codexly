import { lazy, useEffect, useState } from "react";
import { ExtensionCenter } from "@codexly/ui/core/extension-center";
import { useProjectData } from "../projects/project-context.js";

import { useTranslation } from "../../i18n/i18n.js";
import "../../shared/styles/skills-market.css";
import { normalizeExtensionSection, type ExtensionSection } from "./extension-center-nav.js";

const InstalledSkillsPane = lazy(() =>
  import("./installed-skills-pane.js").then((module) => ({ default: module.InstalledSkillsPane })),
);
const McpManagementPane = lazy(() =>
  import("./mcp-management-pane.js").then((module) => ({ default: module.McpManagementPane })),
);
const OfficialPluginsPane = lazy(() =>
  import("./official-plugins-pane.js").then((module) => ({ default: module.OfficialPluginsPane })),
);

export function SkillsMarketContainer({
  onSectionChange,
  section,
}: Readonly<{
  onSectionChange?: (section: ExtensionSection) => void;
  section?: string;
}>) {
  const { t } = useTranslation("workbench");
  const { client, projects } = useProjectData();
  const [activeSection, setActiveSection] = useState(() => normalizeExtensionSection(section));
  useEffect(() => {
    setActiveSection(normalizeExtensionSection(section));
  }, [section]);
  const selectSection = (next: ExtensionSection) => {
    setActiveSection(next);
    onSectionChange?.(next);
  };

  return (
    <ExtensionCenter
      client={client}
      projects={projects}
      section={activeSection}
      onSectionChange={selectSection}
      t={(key, options) => t(key, options ?? {})}
      codexContent={
        <>
          {activeSection === "skills" ? <InstalledSkillsPane /> : null}
          {activeSection === "mcp" ? <McpManagementPane /> : null}
          {activeSection === "plugins" ? <OfficialPluginsPane /> : null}
        </>
      }
    />
  );
}
