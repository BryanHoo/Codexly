import { ApiConnectionFields, ApiConnectionSubmit } from "./api-connection-fields.js";
import { ChatGptConnectionCard } from "./chatgpt-connection-card.js";
import type { AgentProviderConnectionStatus } from "@codexly/protocol";
import { CheckCircle2, Circle, LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";
import { cn } from "../lib/utils.js";
import {
  CustomModelEditor,
  type CustomModelDraft,
  type CustomModelEditorLabels,
} from "./custom-model-editor.js";

type ProviderConnectionLabels = Readonly<{
  account: string;
  apiKey: string;
  baseUrl: string;
  cancelLogin: string;
  connect: string;
  connected: string;
  connecting: string;
  credentials: string;
  custom: string;
  disconnected: string;
  hideKey: string;
  login: string;
  loginHint: string;
  logout: string;
  mode: string;
  official: string;
  reconnect: string;
  retry: string;
  showKey: string;
  waiting: string;
}>;

export type ConnectionMode = "custom" | "official";

export type ProviderConnectionPanelViewProps = Readonly<{
  labels: ProviderConnectionLabels;
  modelLabels: CustomModelEditorLabels;
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

const modes = ["official", "custom"] as const;

export function ProviderConnectionPanelView({
  labels,
  modelLabels,
  autoSave = false,
  setup = false,
  continueLabel,
  apiKey,
  baseUrl,
  error,
  isBusy,
  mode,
  models,
  onAddModel,
  onApiKeyChange,
  onBaseUrlChange,
  onCancelLogin,
  onConfigureCustom,
  onLogout,
  onModelChange,
  onModeChange,
  onRetry,
  onRemoveModel,
  onStartOfficialLogin,
  status,
}: ProviderConnectionPanelViewProps) {
  const flush = () => {
    if (autoSave && baseUrl.trim() !== "" && !hasIncompleteCustomModels(models))
      onConfigureCustom();
  };
  const connected = status?.mode === mode && status.state === "connected";
  const pendingOfficial = status?.mode === "official" && status.state === "pending";
  const pending = isBusy || (mode === "official" && pendingOfficial);
  const stateLabel = pending
    ? mode === "official" && pendingOfficial
      ? labels.waiting
      : labels.connecting
    : connected
      ? labels.connected
      : labels.disconnected;
  const StatusIcon = pending ? LoaderCircle : connected ? CheckCircle2 : Circle;
  // 状态仅描述当前选中的服务，避免把另一种接入方式的账号误显示为已连接。
  const account = connected && status.account?.type === "chatgpt" ? status.account : null;

  return (
    <div className="w-full min-w-0 space-y-6">
      {/* 接入方式与状态共用一行，不再叠加「服务连接」分组标题。 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          aria-label={labels.mode}
          className="inline-flex max-w-full gap-1 rounded-control bg-control p-1"
          role="group"
        >
          {modes.map((value) => (
            <Button
              aria-pressed={mode === value}
              className={cn(
                "min-w-0 px-4",
                mode === value
                  ? "bg-raised text-foreground shadow-control"
                  : "text-muted-foreground",
              )}
              disabled={isBusy}
              key={value}
              onClick={() => {
                onModeChange(value);
              }}
              type="button"
              variant="ghost"
            >
              {labels[value]}
            </Button>
          ))}
        </div>
        {!setup && mode === "custom" ? (
          <span
            className="inline-flex items-center gap-1.5 text-label text-muted-foreground"
            role="status"
          >
            <StatusIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0",
                pending && "motion-safe:animate-spin",
                connected && "text-brand",
              )}
            />
            {stateLabel}
          </span>
        ) : null}
      </div>

      {mode === "official" ? (
        <ChatGptConnectionCard
          connected={connected}
          pending={pendingOfficial}
          busy={isBusy}
          email={account?.email}
          labels={{
            account: labels.account,
            hint: labels.loginHint,
            waiting: labels.waiting,
            connected: labels.connected,
            login: labels.login,
            cancel: labels.cancelLogin,
            logout: labels.logout,
          }}
          onLogin={onStartOfficialLogin}
          onCancel={onCancelLogin}
          onLogout={onLogout}
        />
      ) : (
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isBusy && baseUrl.trim() !== "" && !hasIncompleteCustomModels(models))
              onConfigureCustom();
          }}
        >
          <ApiConnectionFields
            setup={setup}
            hideHeading
            disabled={isBusy}
            baseUrl={baseUrl}
            apiKey={apiKey}
            endpointPlaceholder="https://api.example.com/v1"
            labels={{
              title: labels.credentials,
              endpoint: labels.baseUrl,
              apiKey: labels.apiKey,
              showKey: labels.showKey,
              hideKey: labels.hideKey,
            }}
            onBaseUrlChange={onBaseUrlChange}
            onApiKeyChange={onApiKeyChange}
            onBlur={flush}
          />
          {!setup ? (
            <CustomModelEditor
              labels={modelLabels}
              onBlur={flush}
              disabled={isBusy}
              models={models}
              onAdd={onAddModel}
              onChange={onModelChange}
              onRemove={onRemoveModel}
            />
          ) : null}

          {!autoSave ? (
            <ApiConnectionSubmit
              setup={setup}
              disabled={isBusy || baseUrl.trim() === "" || hasIncompleteCustomModels(models)}
              busy={isBusy}
              label={
                isBusy
                  ? labels.connecting
                  : (continueLabel ?? (connected ? labels.reconnect : labels.connect))
              }
            />
          ) : null}
        </form>
      )}
      {error === null ? null : (
        <div
          className="flex items-start justify-between gap-3 border-l-2 border-danger pl-3 text-body-small"
          role="alert"
        >
          <p className="min-w-0 break-words pt-1 text-danger">{error}</p>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={labels.retry}
                className="shrink-0"
                disabled={isBusy}
                onClick={onRetry}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <RefreshCw aria-hidden="true" className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{labels.retry}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export function hasIncompleteCustomModels(models: readonly CustomModelDraft[]): boolean {
  return models.some((model) => model.id.trim().length === 0 || model.name.trim().length === 0);
}
