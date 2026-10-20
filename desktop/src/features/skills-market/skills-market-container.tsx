import { lazy, Suspense, useEffect, useState } from "react";
import "../../shared/styles/skills-market.css";

import { useTranslation } from "../../i18n/i18n.js";
import {
  ExtensionCenterNav,
  normalizeExtensionSection,
  type ExtensionSection,
} from "./extension-center-nav.js";

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
  const [activeSection, setActiveSection] = useState(() => normalizeExtensionSection(section));
  useEffect(() => setActiveSection(normalizeExtensionSection(section)), [section]);
  const selectSection = (next: ExtensionSection) => {
    setActiveSection(next);
    onSectionChange?.(next);
  };

  return (
    <section aria-label={t("skillsMarket.title")} className="skills-market extension-center">
      <header className="extension-center__header">
        <div className="extension-center__identity">
          <div>
            <span className="skills-market-eyebrow">CODEX EXTENSIONS</span>
            <h2>{t("skillsMarket.title")}</h2>
          </div>
        </div>
        <ExtensionCenterNav active={activeSection} onSelect={selectSection} />
      </header>
      <Suspense
        fallback={
          <div className="skills-market-state" role="status">
            {t("skillsMarket.loadingExtension")}
          </div>
        }
      >
        {activeSection === "skills" ? <InstalledSkillsPane /> : null}
        {activeSection === "mcp" ? <McpManagementPane /> : null}
        {activeSection === "plugins" ? <OfficialPluginsPane /> : null}
      </Suspense>
    </section>
  );
}
