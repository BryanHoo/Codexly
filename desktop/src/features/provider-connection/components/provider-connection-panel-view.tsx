import type { AgentProviderConnectionStatus } from "@/protocol/index.js";
import "../../../i18n/settings-provider.js";
import { CheckCircle2, Circle, Eye, EyeOff, KeyRound, LoaderCircle, LogIn, LogOut, RefreshCw, Server, X } from "lucide-react";
import { useId, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Input } from "../../../shared/components/core/input.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import { cn } from "../../../shared/lib/utils.js";
import { CustomModelEditor, type CustomModelDraft } from "./custom-model-editor.js";

export type ConnectionMode = "custom" | "official";

type ProviderConnectionPanelViewProps = Readonly<{
  apiKey: string;
  baseUrl: string;
  error: string | null;
  isBusy: boolean;
  mode: ConnectionMode;
  models: readonly CustomModelDraft[];
  onAddModel: () => void;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onCancelLogin: () => void;
  onConfigureCustom: () => void;
  onLogout: () => void;
  onModelChange: (key: string, field: "id" | "name", value: string) => void;
  onModeChange: (mode: ConnectionMode) => void;
  onRetry: () => void;
  onRemoveModel: (key: string) => void;
  onStartOfficialLogin: () => void;
  status: AgentProviderConnectionStatus | undefined;
}>;

const modes = [
  { value: "official", icon: LogIn },
  { value: "custom", icon: Server },
] as const;

export function ProviderConnectionPanelView({
  apiKey, baseUrl, error, isBusy, mode, models, onAddModel, onApiKeyChange,
  onBaseUrlChange, onCancelLogin, onConfigureCustom, onLogout, onModelChange,
  onModeChange, onRetry, onRemoveModel, onStartOfficialLogin, status,
}: ProviderConnectionPanelViewProps) {
  const { t } = useTranslation("settings");
  const inputId = useId();
  const [keyVisible, setKeyVisible] = useState(false);
  const connected = status?.mode === mode && status.state === "connected";
  const pendingOfficial = status?.mode === "official" && status.state === "pending";
  const pending = isBusy || (mode === "official" && pendingOfficial);
  const stateLabel = pending ? t(mode === "official" && pendingOfficial ? "provider.waiting" : "provider.connecting")
    : connected ? t("provider.connected") : t("provider.disconnected");
  const StatusIcon = pending ? LoaderCircle : connected ? CheckCircle2 : Circle;
  // 状态仅描述当前选中的服务，避免把另一种接入方式的账号误显示为已连接。
  const account = connected && status?.account?.type === "chatgpt" ? status.account : null;

  return (
    <div className="w-full min-w-0 space-y-6">
      <section aria-label={t("provider.connection")}>
        <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-3">
          <h2 className="text-body font-semibold">{t("provider.connection")}</h2>
          <span className={cn("inline-flex items-center gap-1.5 text-label", connected ? "text-brand" : "text-muted-foreground")} role="status">
            <StatusIcon aria-hidden="true" className={cn("size-3.5 shrink-0", pending && "motion-safe:animate-spin")} />
            {stateLabel}
          </span>
        </div>
        <div aria-label={t("provider.mode")} className="grid w-full grid-cols-2 gap-1 rounded-control bg-control p-1" role="group">
          {modes.map(({ value, icon: Icon }) => (
            <Button
              aria-pressed={mode === value}
              className={cn("h-10 min-w-0 gap-2 text-body-small", mode === value ? "bg-raised text-foreground shadow-control" : "text-muted-foreground")}
              disabled={isBusy}
              key={value}
              onClick={() => {
                setKeyVisible(false);
                onModeChange(value);
              }}
              type="button"
              variant="ghost"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {t(`provider.${value}`)}
            </Button>
          ))}
        </div>
      </section>

      {mode === "official" ? (
        <section aria-label={t("provider.account")} className="border-y border-separator py-6">
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-control bg-control text-foreground">
              <LogIn aria-hidden="true" className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-body font-semibold">{t("provider.account")}</h2>
              <p className="mt-1 break-all text-body-small text-muted-foreground">
                {account?.email ?? stateLabel}
              </p>
              <Button
                className="mt-5 h-9 gap-2"
                disabled={isBusy}
                onClick={pendingOfficial ? onCancelLogin : connected ? onLogout : onStartOfficialLogin}
                type="button"
                variant={pendingOfficial || connected ? "outline" : "default"}
              >
                {isBusy ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                  : pendingOfficial ? <X aria-hidden="true" className="size-4" />
                    : connected ? <LogOut aria-hidden="true" className="size-4" /> : <LogIn aria-hidden="true" className="size-4" />}
                {t(pendingOfficial ? "provider.cancelLogin" : connected ? "provider.logout" : "provider.login")}
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <form className="space-y-6" onSubmit={(event) => {
          event.preventDefault();
          if (!isBusy && baseUrl.trim() !== "" && !hasIncompleteCustomModels(models)) onConfigureCustom();
        }}>
          <section aria-labelledby={`${inputId}-credentials`}>
            <h2 className="mb-3 text-body font-semibold" id={`${inputId}-credentials`}>{t("provider.credentials")}</h2>
            <div className="divide-y divide-separator border-y border-separator">
              <div className="grid grid-cols-[minmax(9rem,1fr)_minmax(0,22rem)] items-center gap-4 py-4">
                <label className="text-body-small font-medium" htmlFor={`${inputId}-url`}>{t("provider.baseUrl")}</label>
                <Input
                  autoCapitalize="none" autoComplete="url" className="font-mono"
                  disabled={isBusy} id={`${inputId}-url`} inputMode="url" maxLength={2_048}
                  onChange={(event) => onBaseUrlChange(event.currentTarget.value)}
                  placeholder="https://api.example.com/v1" spellCheck={false} type="url" value={baseUrl} variant="outline"
                />
              </div>
              <div className="grid grid-cols-[minmax(9rem,1fr)_minmax(0,22rem)] items-center gap-4 py-4">
                <label className="text-body-small font-medium" htmlFor={`${inputId}-key`}>{t("provider.apiKey")}</label>
                <div className="relative min-w-0">
                  <KeyRound aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
                  <Input
                    autoComplete="new-password" className="pl-9 pr-10 font-mono" disabled={isBusy}
                    id={`${inputId}-key`} maxLength={16_384} onChange={(event) => onApiKeyChange(event.currentTarget.value)}
                    spellCheck={false} type={keyVisible ? "text" : "password"} value={apiKey} variant="outline"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button aria-label={t(keyVisible ? "provider.hideKey" : "provider.showKey")} aria-pressed={keyVisible}
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground" disabled={isBusy}
                        onClick={() => setKeyVisible((visible) => !visible)} size="icon-sm" type="button" variant="ghost">
                        {keyVisible ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t(keyVisible ? "provider.hideKey" : "provider.showKey")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </section>
          <CustomModelEditor disabled={isBusy} models={models} onAdd={onAddModel} onChange={onModelChange} onRemove={onRemoveModel} />
          <div className="flex justify-end border-t border-separator pt-4">
            <Button className="h-9 gap-2" disabled={isBusy || baseUrl.trim() === "" || hasIncompleteCustomModels(models)} type="submit">
              {isBusy ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" /> : <Server aria-hidden="true" className="size-4" />}
              {t(isBusy ? "provider.connecting" : connected ? "provider.reconnect" : "provider.connect")}
            </Button>
          </div>
        </form>
      )}
      {error === null ? null : (
        <div className="flex items-start justify-between gap-3 border-l-2 border-danger pl-3 text-body-small" role="alert">
          <p className="min-w-0 break-words pt-1 text-danger">{error}</p>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label={t("provider.retry")} className="shrink-0" disabled={isBusy} onClick={onRetry} size="icon-sm" type="button" variant="ghost">
                <RefreshCw aria-hidden="true" className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("provider.retry")}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export function hasIncompleteCustomModels(models: readonly CustomModelDraft[]): boolean {
  return models.some((model) => model.id.trim().length === 0 || model.name.trim().length === 0);
}
