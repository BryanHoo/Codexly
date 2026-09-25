import { BadgeCheck, Blocks, Server, Store } from "lucide-react";

import { useTranslation } from "../../i18n/i18n.js";

export type ExtensionSection = "marketplace" | "mcp" | "plugins" | "skills";

const sections = [
  { icon: Blocks, value: "skills" },
  { icon: Server, value: "mcp" },
  { icon: BadgeCheck, value: "plugins" },
  { icon: Store, value: "marketplace" },
] as const;

export function normalizeExtensionSection(value: string | undefined): ExtensionSection {
  return sections.some((section) => section.value === value)
    ? (value as ExtensionSection)
    : "skills";
}

export function ExtensionCenterNav({
  active,
  onSelect,
}: Readonly<{
  active: ExtensionSection;
  onSelect: (section: ExtensionSection) => void;
}>) {
  const { t } = useTranslation("workbench");
  return (
    <div aria-label={t("skillsMarket.sectionsLabel")} className="skills-market-tabs" role="tablist">
      {sections.map(({ icon: Icon, value }) => (
        <button
          aria-selected={active === value}
          key={value}
          onClick={() => onSelect(value)}
          role="tab"
          type="button"
        >
          <Icon aria-hidden="true" />
          {t(`skillsMarket.tabs.${value}`)}
        </button>
      ))}
    </div>
  );
}
