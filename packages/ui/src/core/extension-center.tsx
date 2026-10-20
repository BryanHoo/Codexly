import { lazy, Suspense, useState, type ReactNode } from "react";
import { ArrowUpRight, BadgeCheck, Blocks, Server } from "lucide-react";
import type { ClaudeExtensionClient, ClaudeExtensionKind } from "@codexly/protocol";

import { ExtensionProjectScope } from "./extension-project-scope.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";
import { useSelectedEngines } from "./engine-selection.js";
import type { ExtensionTranslate } from "./extension-center-types.js";
const sections = [
  { value: "skills", icon: Blocks },
  { value: "mcp", icon: Server },
  { value: "plugins", icon: BadgeCheck },
] as const;
const ClaudeExtensionsPane = lazy(() =>
  import("./claude-extensions-pane.js").then((module) => ({
    default: module.ClaudeExtensionsPane,
  })),
);

/** 两端共享引擎切换与范围选择；仅挂载当前引擎，避免后台查询及运行时启动。 */
export function ExtensionCenter({
  client,
  projects,
  section,
  onSectionChange,
  t,
  codexContent,
}: Readonly<{
  client: ClaudeExtensionClient;
  projects: readonly Readonly<{ id: string; name: string }>[];
  section: ClaudeExtensionKind;
  onSectionChange: (section: ClaudeExtensionKind) => void;
  t: ExtensionTranslate;
  codexContent: ReactNode;
}>) {
  const selectedEngines = useSelectedEngines();
  const [engine, setEngine] = useState<"codex" | "claude">(() =>
    selectedEngines?.length === 1 && selectedEngines[0] === "claude" ? "claude" : "codex",
  );
  const [projectId, setProjectId] = useState("");
  const activeProject = projects.some((project) => project.id === projectId) ? projectId : "";
  return (
    <section aria-label={t("skillsMarket.title")} className="skills-market extension-center">
      <div className="extension-center__controls">
        <header className="extension-center__header">
          <div
            className="extension-center__engines"
            role="group"
            aria-label={t("skillsMarket.center.engine")}
          >
            {(["codex", "claude"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={engine === value}
                onClick={() => {
                  setEngine(value);
                }}
              >
                {value === "codex" ? "Codex" : "Claude"}
              </button>
            ))}
          </div>
          <div className="extension-center__tools">
            <Select
              value={activeProject ? `project:${activeProject}` : "user"}
              onValueChange={(value) => {
                setProjectId(value.startsWith("project:") ? value.slice(8) : "");
              }}
            >
              <SelectTrigger
                size="sm"
                className="max-w-44"
                aria-label={t("skillsMarket.center.scope")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectItem value="user">{t("skillsMarket.center.global")}</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={`project:${project.id}`}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  className="extension-center__docs"
                  href={
                    engine === "claude"
                      ? `https://code.claude.com/docs/en/${section === "plugins" ? "discover-plugins" : section}`
                      : `https://developers.openai.com/codex/${section === "plugins" ? "plugins" : section}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("skillsMarket.center.documentation")}
                >
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </TooltipTrigger>
              <TooltipContent>{t("skillsMarket.center.documentation")}</TooltipContent>
            </Tooltip>
          </div>
        </header>
        <div className="extension-center__navigation">
          <div
            className="skills-market-tabs"
            role="tablist"
            aria-label={t("skillsMarket.sectionsLabel")}
          >
            {sections.map(({ value, icon: Icon }, index) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`extension-tab-${value}`}
                aria-controls="extension-panel"
                aria-selected={section === value}
                tabIndex={section === value ? 0 : -1}
                onClick={() => {
                  onSectionChange(value);
                }}
                onKeyDown={(event) => {
                  let next: number | undefined;
                  if (event.key === "ArrowRight") next = (index + 1) % sections.length;
                  if (event.key === "ArrowLeft")
                    next = (index + sections.length - 1) % sections.length;
                  if (event.key === "Home") next = 0;
                  if (event.key === "End") next = sections.length - 1;
                  if (next !== undefined) {
                    event.preventDefault();
                    const target = sections[next];
                    if (!target) return;
                    onSectionChange(target.value);
                    document.getElementById(`extension-tab-${target.value}`)?.focus();
                  }
                }}
              >
                <Icon aria-hidden="true" />
                {t(`skillsMarket.tabs.${value}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div
        id="extension-panel"
        role="tabpanel"
        aria-labelledby={`extension-tab-${section}`}
        tabIndex={0}
      >
        <Suspense
          fallback={
            <div className="skills-market-state" role="status">
              {t("skillsMarket.loadingExtension")}
            </div>
          }
        >
          {engine === "codex" ? (
            <ExtensionProjectScope.Provider
              key={`${section}:${activeProject}`}
              value={activeProject || undefined}
            >
              {codexContent}
            </ExtensionProjectScope.Provider>
          ) : (
            <ClaudeExtensionsPane
              key={`${section}:${activeProject}`}
              client={client}
              kind={section}
              projectId={activeProject || undefined}
              t={t}
            />
          )}
        </Suspense>
      </div>
    </section>
  );
}
