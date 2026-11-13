import { SettingsDialog } from "@codexly/ui/core/settings-dialog";
import type { AcpAuthClient } from "@codexly/ui/core/acp-auth-settings";
import { EngineSettingsGate } from "./engine-settings-gate.js";
import { settingsSectionEngine } from "@codexly/frontend-core/settings-navigation";
import { SettingsSaveFeedbackProvider } from "@codexly/ui/core/settings-save-status";
import { Search, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { settingsSections, type SettingsSectionId } from "./global-settings-fields.js";

import {
  settingsSectionGroups as sectionGroups,
  settingsSectionSearchKeys as sectionSearchKeys,
} from "@codexly/frontend-core/settings-navigation";

export function SettingsPageFrame({
  agentRuntime = "legacy",
  acpClient,
  activeSection,
  accessMode = "local",
  children,
  onBack,
  onSectionChange,
}: Readonly<{
  acpClient?: Partial<Pick<AcpAuthClient, "getAcpAgent">>;
  agentRuntime?: "pending" | "legacy" | "acp";
  activeSection: SettingsSectionId;
  accessMode?: "local" | "lan";
  children: ReactNode;
  onBack: () => void;
  onSectionChange: (section: SettingsSectionId) => void;
}>) {
  const { t } = useTranslation("settings");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const engine = settingsSectionEngine(activeSection);
  const query = search.trim().toLocaleLowerCase();
  const matches = settingsSections
    .filter(({ id }) => id !== "access" || accessMode === "lan")
    .filter(({ id }) =>
      [
        t(`sections.${id}`),
        ...sectionGroups
          .filter((group) => group.sections.some((section) => section === id))
          .map((group) => t(`groups.${group.id}`)),
        t(`sectionKeywords.${id}`),
        ...sectionSearchKeys[id].map((key) => t(key)),
      ].some((label) => label.toLocaleLowerCase().includes(query)),
    );

  return (
    <SettingsSaveFeedbackProvider onBack={onBack}>
      {(requestBack, requestNavigation) => (
        <SettingsDialog title={t("title")} closeLabel={t("actions.close")} onClose={requestBack}>
          <div
            role="region"
            aria-label={t("title")}
            className="settings-page grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[var(--ui-layout-settings-sidebar-width)_minmax(0,1fr)] sm:grid-rows-1 overflow-hidden bg-window text-foreground"
          >
            <aside className="flex min-h-0 min-w-0 flex-col bg-control px-3 py-4">
              <div className="mb-6 flex h-9 shrink-0 items-center gap-2 rounded-control bg-control px-2.5 focus-within:shadow-focus">
                <Search aria-hidden="true" className="text-subtle-foreground" />
                <input
                  aria-label={t("search.label")}
                  className="min-w-0 flex-1 bg-transparent text-body-small !outline-none placeholder:text-subtle-foreground [&::-webkit-search-cancel-button]:appearance-none"
                  onChange={(event) => {
                    setSearch(event.currentTarget.value);
                  }}
                  placeholder={t("search.placeholder")}
                  ref={searchRef}
                  type="search"
                  value={search}
                />
                {search === "" ? null : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("search.clear")}
                        className="size-6 shrink-0"
                        onClick={() => {
                          setSearch("");
                          searchRef.current?.focus();
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("search.clear")}</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <nav
                aria-label={t("navigationLabel")}
                className="flex min-h-0 gap-4 overflow-x-auto sm:block sm:space-y-6 sm:overflow-y-auto overscroll-contain"
              >
                {sectionGroups.map((group) => {
                  const sections = matches.filter(({ id }) =>
                    group.sections.some((section) => section === id),
                  );
                  if (sections.length === 0) return null;
                  return (
                    <div key={group.id} role="group" aria-label={t(`groups.${group.id}`)}>
                      <p className="mb-2 px-2.5 text-label text-subtle-foreground">
                        {t(`groups.${group.id}`)}
                      </p>
                      <div className="flex gap-1 sm:block sm:space-y-1">
                        {sections.map(({ icon: Icon, id }) => (
                          <Button
                            aria-current={activeSection === id ? "page" : undefined}
                            contentAlign="start"
                            className={`h-9 sm:w-full justify-start gap-2.5 px-2.5 text-body-small ${activeSection === id ? "bg-control-hover text-foreground" : "text-muted-foreground"}`}
                            key={id}
                            onClick={() => {
                              requestNavigation(() => {
                                onSectionChange(id);
                              });
                              contentRef.current?.scrollTo({ top: 0 });
                            }}
                            type="button"
                            variant="ghost"
                          >
                            <Icon aria-hidden="true" />
                            <span className="min-w-0 truncate">{t(`sections.${id}`)}</span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {matches.length === 0 ? (
                  <p className="px-2.5 text-body-small text-muted-foreground" role="status">
                    {t("search.empty")}
                  </p>
                ) : null}
              </nav>
            </aside>
            <main
              aria-label={t("title")}
              className={
                activeSection === "acp"
                  ? "min-h-0 min-w-0 overflow-hidden"
                  : "min-h-0 min-w-0 overflow-y-auto px-5 py-6 sm:px-10 sm:py-12"
              }
              ref={contentRef}
            >
              <div
                className={
                  activeSection === "acp" ? "h-full min-h-0 w-full" : "mx-auto w-full max-w-content"
                }
              >
                {engine ? (
                  <EngineSettingsGate
                    key={engine}
                    engine={engine}
                    runtime={agentRuntime}
                    {...(acpClient ? { acpClient } : {})}
                  >
                    {children}
                  </EngineSettingsGate>
                ) : (
                  children
                )}
              </div>
            </main>
          </div>
        </SettingsDialog>
      )}
    </SettingsSaveFeedbackProvider>
  );
}
