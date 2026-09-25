import type { AgentModel } from "@/protocol/index.js";
import {
  Bot,
  ChevronDown,
  Info,
  PawPrint,
  SlidersHorizontal,
  Settings,
  ServerCog,
  type LucideIcon,
} from "lucide-react";
import { useId, type ReactNode, type SelectHTMLAttributes } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { PromptInputSelect } from "../../../shared/components/agent/prompt-input.js";
import { Checkbox } from "../../../shared/components/core/checkbox.js";

export type SettingsSectionId =
  | "about"
  | "agent"
  | "appearance"
  | "pets"
  | "personalization"
  | "provider";

export const settingsSections: readonly Readonly<{
  icon: LucideIcon;
  id: SettingsSectionId;
}>[] = [
  { icon: Settings, id: "appearance" },
  { icon: PawPrint, id: "pets" },
  { icon: ServerCog, id: "provider" },
  { icon: Bot, id: "agent" },
  { icon: SlidersHorizontal, id: "personalization" },
  { icon: Info, id: "about" },
];

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
  if (activeSection !== id) return null;
  return (
    <section id={`settings-panel-${id}`}>
      <h1 className="mb-6 text-xl font-semibold">{title}</h1>
      <SettingsCard>{children}</SettingsCard>
    </section>
  );
}

export function SettingsGroup({ children, title, description }: Readonly<{ children: ReactNode; title: string; description?: string }>) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 className={`${description === undefined ? "mb-2" : "mb-1"} text-body font-semibold`} id={id}>{title}</h2>
      {description === undefined ? null : <p className="mb-3 text-body-small text-muted-foreground">{description}</p>}
      <SettingsCard>{children}</SettingsCard>
    </section>
  );
}

function SettingsCard({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="divide-y divide-separator rounded-surface border border-separator bg-panel px-4">
      {children}
    </div>
  );
}

export function SettingsField({
  alignStart = false,
  children,
  description,
  label,
}: Readonly<{
  alignStart?: boolean;
  children: ReactNode;
  description?: string;
  label: string;
}>) {
  return (
    <div
      className={`grid min-h-14 ${description === undefined ? "grid-cols-[minmax(9rem,1fr)_minmax(0,22rem)]" : "grid-cols-[minmax(0,1fr)_minmax(10rem,16rem)]"} gap-4 py-3 ${alignStart ? "items-start" : "items-center"}`}
    >
      <div className={`min-w-0 ${alignStart ? "pt-2" : ""}`}>
        <span className="block text-body-small font-medium text-foreground">{label}</span>
        {description === undefined ? null : <p className="mt-0.5 text-label text-muted-foreground">{description}</p>}
      </div>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

export function FastModeSettingsField({
  disabled = false,
  enabled,
  onChange,
}: Readonly<{ disabled?: boolean; enabled: boolean; onChange: (enabled: boolean) => void }>) {
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

export function ModelSelect({
  ariaLabel,
  disabled = false,
  models,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string;
  disabled?: boolean;
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
    <div className="relative min-w-40 max-w-full">
      <PromptInputSelect
        className="h-8 w-full max-w-none !border !border-separator-strong !bg-control px-2.5 pr-8 text-body-small text-foreground"
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
