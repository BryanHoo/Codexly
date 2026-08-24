import type { AgentModel } from "@code-agent/protocol";
import {
  Bot,
  ChevronDown,
  GitCommitHorizontal,
  Info,
  MonitorCog,
  Moon,
  Network,
  Palette,
  ServerCog,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";

import type { SupportedLanguage } from "../../../i18n/language-preference.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { PromptInputSelect } from "../../../shared/components/agent/prompt-input.js";
import { Button } from "../../../shared/components/core/button.js";
import { Checkbox } from "../../../shared/components/core/checkbox.js";
import type { ThemePreference } from "../theme-preference.js";

export type SettingsSectionId =
  "about" | "access" | "agent" | "appearance" | "commit" | "integration" | "provider";

export const settingsSections: readonly Readonly<{
  icon: LucideIcon;
  id: SettingsSectionId;
}>[] = [
  { icon: Palette, id: "appearance" },
  { icon: ServerCog, id: "provider" },
  { icon: Bot, id: "agent" },
  { icon: GitCommitHorizontal, id: "commit" },
  { icon: MonitorCog, id: "integration" },
  { icon: Network, id: "access" },
  { icon: Info, id: "about" },
];

const themeOptions = [
  {
    ariaKey: "appearance.automaticMode",
    icon: MonitorCog,
    labelKey: "appearance.automatic",
    value: "system",
  },
  { ariaKey: "appearance.lightMode", icon: Sun, labelKey: "appearance.light", value: "light" },
  { ariaKey: "appearance.darkMode", icon: Moon, labelKey: "appearance.dark", value: "dark" },
] as const;

export function SettingsPanel({
  activeSection,
  children,
  id,
  title,
}: Readonly<{
  activeSection: SettingsSectionId;
  children: ReactNode;
  id: SettingsSectionId;
  title: string;
}>) {
  return (
    <section hidden={activeSection !== id} id={`settings-panel-${id}`}>
      <h3 className="mb-4 text-heading font-semibold">{title}</h3>
      <div className="divide-y divide-separator">{children}</div>
    </section>
  );
}

export function SettingsField({
  alignStart = false,
  children,
  label,
}: Readonly<{
  alignStart?: boolean;
  children: ReactNode;
  label: string;
}>) {
  return (
    <div
      className={`grid min-h-16 gap-3 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] ${alignStart ? "items-start" : "items-center"}`}
    >
      <span className={`text-body-small font-medium text-foreground ${alignStart ? "pt-2" : ""}`}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function FastModeSettingsField({
  disabled,
  enabled,
  onChange,
}: Readonly<{ disabled: boolean; enabled: boolean; onChange: (enabled: boolean) => void }>) {
  const { t } = useTranslation("settings");
  const label = t("fields.fastMode");
  return (
    <SettingsField label={label}>
      <Checkbox
        aria-label={label}
        checked={enabled}
        disabled={disabled}
        onCheckedChange={(checked) => {
          onChange(checked === true);
        }}
      />
    </SettingsField>
  );
}

export function ThemeButton({
  ariaLabel,
  icon: Icon,
  label,
  onClick,
  selected,
}: Readonly<{
  ariaLabel: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  selected: boolean;
}>) {
  return (
    <Button
      aria-label={ariaLabel}
      aria-pressed={selected}
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-[5px] px-1 text-body-small font-medium transition-colors ${selected ? "bg-raised text-foreground shadow-control" : "text-muted-foreground hover:text-foreground"}`}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <Icon aria-hidden="true" className="hidden size-4 min-[360px]:block" />
      <span>{label}</span>
    </Button>
  );
}

export function AppearanceSettingsPanel({
  activeSection,
  language,
  notificationsEnabled,
  onLanguageChange,
  onNotificationsChange,
  onThemeChange,
  theme,
}: Readonly<{
  activeSection: SettingsSectionId;
  language: SupportedLanguage;
  notificationsEnabled: boolean;
  onLanguageChange: (language: SupportedLanguage) => void;
  onNotificationsChange: (enabled: boolean) => void;
  onThemeChange: (theme: ThemePreference) => void;
  theme: ThemePreference;
}>) {
  const { t } = useTranslation("settings");
  return (
    <SettingsPanel activeSection={activeSection} id="appearance" title={t("sections.appearance")}>
      <SettingsField label={t("appearance.colorMode")}>
        <div className="grid grid-cols-3 rounded-control bg-control p-0.5">
          {themeOptions.map((option) => {
            return (
              <ThemeButton
                ariaLabel={t(option.ariaKey)}
                icon={option.icon}
                key={option.value}
                label={t(option.labelKey)}
                onClick={() => {
                  onThemeChange(option.value);
                }}
                selected={theme === option.value}
              />
            );
          })}
        </div>
      </SettingsField>
      <SettingsField label={t("appearance.language")}>
        <SettingsSelect
          aria-label={t("appearance.language")}
          onChange={(event) => {
            onLanguageChange(event.currentTarget.value as SupportedLanguage);
          }}
          value={language}
        >
          <option value="zh-CN">{t("languages.zhCN")}</option>
          <option value="en">{t("languages.en")}</option>
        </SettingsSelect>
      </SettingsField>
      <SettingsField label={t("appearance.notifications")}>
        <SettingsSelect
          aria-label={t("appearance.notifications")}
          onChange={(event) => {
            onNotificationsChange(event.currentTarget.value === "enabled");
          }}
          value={notificationsEnabled ? "enabled" : "disabled"}
        >
          <option value="enabled">{t("notifications.enabled")}</option>
          <option value="disabled">{t("notifications.disabled")}</option>
        </SettingsSelect>
      </SettingsField>
    </SettingsPanel>
  );
}

export function ModelSelect({
  ariaLabel,
  disabled,
  models,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string;
  disabled: boolean;
  models: readonly AgentModel[];
  onChange: (modelId: string) => void;
  value: string;
}>) {
  return (
    <SettingsSelect
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      value={value}
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.displayName}
        </option>
      ))}
    </SettingsSelect>
  );
}

export function ReasoningSelect({
  ariaLabel,
  disabled,
  model,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string;
  disabled: boolean;
  model: AgentModel | undefined;
  onChange: (effort: string) => void;
  value: string;
}>) {
  const { t } = useTranslation("settings");
  return (
    <SettingsSelect
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      value={value}
    >
      {model?.supportedReasoningEfforts.map((effort) => (
        <option key={effort.id} value={effort.id}>
          {t(`effort.${effort.id}`, { defaultValue: effort.id })}
        </option>
      ))}
    </SettingsSelect>
  );
}

export function SettingsSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0">
      <PromptInputSelect
        className="h-9 w-full max-w-none !border !border-separator-strong !bg-control px-2.5 pr-8 text-body-small text-foreground"
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
