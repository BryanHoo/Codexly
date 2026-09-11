import { ArrowLeft, Search, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { settingsSections, type SettingsSectionId } from "./global-settings-fields.js";

const sectionGroups = [
  { id: "personal", sections: ["appearance", "pets"] },
  { id: "coding", sections: ["provider", "agent", "personalization"] },
  { id: "app", sections: ["access", "about"] },
] as const;

// 搜索仅索引已有分类与字段文案，不为搜索挂载面板或请求额外配置数据。
const sectionSearchKeys: Record<SettingsSectionId, readonly string[]> = {
  access: ["access.logout"],
  personalization: [
    "personalization.instructions",
    "personalization.memories",
    "personalization.enabled",
    "personalization.external",
    "fields.commitModel",
    "fields.commitMessagePrompt",
    "fields.prompt",
  ],
  appearance: [
    "appearance.colorMode",
    "appearance.language",
    "appearance.notifications",
    "fields.defaultOpenWith",
    "fields.followUpMessages",
    "general.editor",
    "general.taskNotifications",
    "background.label",
    "background.bing",
    "background.custom",
    "background.blurLabel",
    "background.overlayOpacityLabel",
  ],
  pets: ["pets.enabled", "pets.selectionLabel"],
  provider: [
    "provider.apiKey",
    "provider.baseUrl",
    "provider.models",
    "provider.official",
    "provider.custom",
  ],
  agent: [
    "fields.fastMode",
    "fields.model",
    "fields.reasoningEffort",
    "fields.approvalPolicy",
    "fields.sandbox",
    "agent.webSearch.label",
    "agent.modelVerbosity.label",
  ],
  about: ["about.codexlyVersion", "about.codexVersion", "about.update", "about.releaseNotes"],
};

export function SettingsPageFrame({
  activeSection,
  accessMode = "local",
  children,
  onBack,
  onSectionChange,
}: Readonly<{
  activeSection: SettingsSectionId;
  accessMode?: "local" | "lan";
  children: ReactNode;
  onBack: () => void;
  onSectionChange: (section: SettingsSectionId) => void;
}>) {
  const { t } = useTranslation("settings");
  const [search, setSearch] = useState("");
  const backRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const matches = settingsSections
    .filter(({ id }) => id !== "access" || accessMode === "lan")
    .filter(({ id }) =>
      [
        t(`sections.${id}`),
        t(`sectionKeywords.${id}`),
        ...sectionSearchKeys[id].map((key) => t(key)),
      ].some((label) => label.toLocaleLowerCase().includes(query)),
    );

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);

  const handleEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    // 更新日志等 Portal 弹窗优先处理 Escape，避免一次按键同时退出设置。
    const modalOpen = [
      ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]'),
    ].some((element) => element.getClientRects().length > 0);
    if (modalOpen) return;
    event.preventDefault();
    if (search !== "") setSearch("");
    else onBack();
  });
  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div
      role="region"
      aria-label={t("title")}
      className="settings-page grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[var(--ui-layout-settings-sidebar-width)_minmax(0,1fr)] sm:grid-rows-1 overflow-hidden bg-window text-foreground"
    >
      <aside className="flex min-h-0 min-w-0 flex-col bg-control px-3 py-3 sm:pb-5 sm:pt-6">
        <Button
          contentAlign="start"
          className="mb-5 h-9 w-full justify-start gap-2 px-2.5 text-body"
          onClick={onBack}
          ref={backRef}
          type="button"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" />
          {t("actions.backToApp")}
        </Button>
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
          className="flex min-h-0 gap-4 overflow-x-auto sm:block sm:space-y-6 sm:overflow-y-auto"
        >
          {sectionGroups.map((group) => {
            const sections = matches.filter(({ id }) =>
              group.sections.some((section) => section === id),
            );
            if (sections.length === 0) return null;
            return (
              <div key={group.id}>
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
                        onSectionChange(id);
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
        className="min-h-0 min-w-0 overflow-y-auto px-5 py-6 sm:px-10 sm:py-12"
        ref={contentRef}
      >
        <div className="mx-auto w-full max-w-content">{children}</div>
      </main>
    </div>
  );
}
