import { ApiConnectionFields, ApiConnectionSubmit } from "@codexly/ui/core/api-connection-fields";
import { ChatGptConnectionCard } from "@codexly/ui/core/chatgpt-connection-card";
import type { AgentProviderConnectionStatus } from "@/protocol/index.js";
import "../../../i18n/settings-provider.js";
import { CheckCircle2, Circle, LoaderCircle, LogIn, RefreshCw, Server } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import { cn } from "../../../shared/lib/utils.js";
import { CustomModelEditor, type CustomModelDraft } from "./custom-model-editor.js";

export type ConnectionMode = "custom" | "official";

type ProviderConnectionPanelViewProps = Readonly<{
  autoSave?: boolean;
  setup?: boolean;
  continueLabel?: string | undefined;
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
  autoSave = false,
  setup = false,
  continueLabel,
  apiKey, baseUrl, error, isBusy, mode, models, onAddModel, onApiKeyChange,
  onBaseUrlChange, onCancelLogin, onConfigureCustom, onLogout, onModelChange,
  onModeChange, onRetry, onRemoveModel, onStartOfficialLogin, status,
}: ProviderConnectionPanelViewProps) {
  const { t } = useTranslation("settings");
  const flush = () => {
    if (autoSave && baseUrl.trim() !== "" && !hasIncompleteCustomModels(models)) onConfigureCustom();
  };
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
        {!setup && mode === "custom" ? <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-3">
          <h2 className="text-body font-semibold">{t("provider.connection")}</h2>
          <span className={cn("inline-flex items-center gap-1.5 text-label", connected ? "text-brand" : "text-muted-foreground")} role="status">
            <StatusIcon aria-hidden="true" className={cn("size-3.5 shrink-0", pending && "motion-safe:animate-spin")} />
            {stateLabel}
          </span>
        </div> : null}
        <div aria-label={t("provider.mode")} className="grid w-full max-w-[30rem] grid-cols-2 gap-1 rounded-control bg-control p-1" role="group">
          {modes.map(({ value, icon: Icon }) => (
            <Button
              aria-pressed={mode === value}
              className={cn("h-10 min-w-0 gap-2 text-body-small", mode === value ? "bg-raised text-foreground shadow-control" : "text-muted-foreground")}
              disabled={isBusy}
              key={value}
              onClick={() => {
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
        <ChatGptConnectionCard
          connected={connected} pending={pendingOfficial} busy={isBusy} email={account?.email}
          labels={{account: t("provider.account"), hint: t("provider.loginHint"), waiting: t("provider.waiting"), connected: t("provider.connected"), login: t("provider.login"), cancel: t("provider.cancelLogin"), logout: t("provider.logout")}}
          onLogin={onStartOfficialLogin} onCancel={onCancelLogin} onLogout={onLogout}
        />
      ) : (
        <form className="space-y-6" onSubmit={(event) => {
          event.preventDefault();
          if (!isBusy && baseUrl.trim() !== "" && !hasIncompleteCustomModels(models)) onConfigureCustom();
        }}>
          <ApiConnectionFields
            setup={setup} disabled={isBusy} baseUrl={baseUrl} apiKey={apiKey}
            endpointPlaceholder="https://api.example.com/v1"
            labels={{ title: t("provider.credentials"), endpoint: t("provider.baseUrl"), apiKey: t("provider.apiKey"), showKey: t("provider.showKey"), hideKey: t("provider.hideKey") }}
            onBaseUrlChange={onBaseUrlChange} onApiKeyChange={onApiKeyChange} onBlur={flush}
          />
          {!setup ? <CustomModelEditor onBlur={flush} disabled={isBusy} models={models} onAdd={onAddModel} onChange={onModelChange} onRemove={onRemoveModel} /> : null}

          {!autoSave ? (
            <ApiConnectionSubmit
              setup={setup} disabled={isBusy || baseUrl.trim() === "" || hasIncompleteCustomModels(models)} busy={isBusy}
              label={isBusy ? t("provider.connecting") : (continueLabel ?? t(connected ? "provider.reconnect" : "provider.connect"))}
            />
          ) : null}
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
