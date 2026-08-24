import type {
  AgentProviderConnectionStatus,
  ConfigureCustomProviderRequest,
} from "@code-agent/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  Server,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";
import { cn } from "../../../shared/lib/utils.js";
import { Button } from "../../../shared/components/core/button.js";
import { Input } from "../../../shared/components/core/input.js";
import {
  cancelProviderLoginMutationOptions,
  configureCustomProvider,
  logoutProviderMutationOptions,
  providerConnectionQueryOptions,
  startOfficialProviderLoginMutationOptions,
} from "../provider-connection-queries.js";
import { CustomModelEditor, type CustomModelDraft } from "./custom-model-editor.js";

type ConnectionMode = "custom" | "official";

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

export function ProviderConnectionPanelView({
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
  const { t } = useTranslation("settings");
  const currentModeConnected = status?.mode === mode && status.state === "connected";
  const pendingOfficial = status?.mode === "official" && status.state === "pending";

  return (
    <div className="w-full max-w-[38rem]">
      <div
        aria-label={t("provider.mode")}
        className="grid grid-cols-2 rounded-control bg-control p-1"
        role="group"
      >
        <Button
          aria-pressed={mode === "official"}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-[5px] text-body-small font-medium sm:h-9",
            mode === "official"
              ? "bg-raised text-foreground shadow-control"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => {
            onModeChange("official");
          }}
          type="button"
          variant="ghost"
        >
          <LogIn aria-hidden="true" data-icon="inline-start" />
          {t("provider.official")}
        </Button>
        <Button
          aria-pressed={mode === "custom"}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-[5px] text-body-small font-medium sm:h-9",
            mode === "custom"
              ? "bg-raised text-foreground shadow-control"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => {
            onModeChange("custom");
          }}
          type="button"
          variant="ghost"
        >
          <Server aria-hidden="true" data-icon="inline-start" />
          {t("provider.custom")}
        </Button>
      </div>

      <div className="mt-5">
        {mode === "official" ? (
          <div className="grid gap-4">
            <div className="flex min-h-12 items-center gap-3 border-b border-separator pb-4">
              {currentModeConnected ? (
                <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-brand" />
              ) : pendingOfficial ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-5 shrink-0 animate-spin text-brand"
                />
              ) : (
                <LogIn aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p className="text-body-small font-medium text-foreground">
                  {currentModeConnected
                    ? t("provider.connected")
                    : pendingOfficial
                      ? t("provider.waiting")
                      : t("provider.disconnected")}
                </p>
                {status?.account?.type === "chatgpt" && status.account.email !== null ? (
                  <p className="truncate text-meta text-muted-foreground">{status.account.email}</p>
                ) : null}
              </div>
            </div>
            {pendingOfficial ? (
              <Button
                className="h-11 justify-self-start sm:h-9"
                disabled={isBusy}
                onClick={onCancelLogin}
                type="button"
                variant="outline"
              >
                <X aria-hidden="true" className="size-4" />
                {t("provider.cancelLogin")}
              </Button>
            ) : currentModeConnected ? (
              <Button
                className="h-11 justify-self-start sm:h-9"
                disabled={isBusy}
                onClick={onLogout}
                type="button"
                variant="outline"
              >
                <LogOut aria-hidden="true" className="size-4" />
                {t("provider.logout")}
              </Button>
            ) : (
              <Button
                className="h-11 justify-self-start sm:h-9"
                disabled={isBusy}
                onClick={onStartOfficialLogin}
                type="button"
              >
                {isBusy ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <LogIn aria-hidden="true" className="size-4" />
                )}
                {t("provider.login")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-body-small font-medium text-foreground">
              {t("provider.baseUrl")}
              <Input
                autoCapitalize="none"
                autoComplete="url"
                disabled={isBusy}
                inputMode="url"
                maxLength={2_048}
                onChange={(event) => {
                  onBaseUrlChange(event.currentTarget.value);
                }}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                type="url"
                value={baseUrl}
                variant="outline"
              />
            </label>
            <label className="grid gap-1.5 text-body-small font-medium text-foreground">
              {t("provider.apiKey")}
              <div className="relative">
                <KeyRound
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  autoComplete="new-password"
                  className="pl-9"
                  disabled={isBusy}
                  maxLength={16_384}
                  onChange={(event) => {
                    onApiKeyChange(event.currentTarget.value);
                  }}
                  spellCheck={false}
                  type="password"
                  value={apiKey}
                  variant="outline"
                />
              </div>
            </label>
            <div className="grid gap-1.5 text-body-small font-medium text-foreground">
              <span>{t("provider.models")}</span>
              <CustomModelEditor
                disabled={isBusy}
                models={models}
                onAdd={onAddModel}
                onChange={onModelChange}
                onRemove={onRemoveModel}
              />
            </div>
            {currentModeConnected ? (
              <div className="flex items-center gap-2 text-body-small text-brand">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                <span>{t("provider.connected")}</span>
              </div>
            ) : null}
            <Button
              className="h-11 justify-self-start sm:h-9"
              disabled={isBusy || baseUrl.trim().length === 0 || hasIncompleteCustomModels(models)}
              onClick={onConfigureCustom}
              type="button"
            >
              {isBusy ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Server aria-hidden="true" className="size-4" />
              )}
              {currentModeConnected ? t("provider.reconnect") : t("provider.connect")}
            </Button>
          </div>
        )}
      </div>

      {error === null ? null : (
        <div className="mt-4 flex items-center justify-between gap-3 text-body-small" role="alert">
          <p className="min-w-0 text-danger">{error}</p>
          <Button
            aria-label={t("provider.retry")}
            className="shrink-0"
            onClick={onRetry}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function hasIncompleteCustomModels(models: readonly CustomModelDraft[]): boolean {
  return models.some((model) => model.id.trim().length === 0 || model.name.trim().length === 0);
}

export function createCustomProviderInput({
  apiKey,
  baseUrl,
  models,
}: Readonly<{
  apiKey: string;
  baseUrl: string;
  models: readonly CustomModelDraft[];
}>): ConfigureCustomProviderRequest {
  const customModels = models.map(({ id, name }) => ({ id: id.trim(), name: name.trim() }));
  return {
    ...(apiKey.length === 0 ? {} : { apiKey }),
    baseUrl: baseUrl.trim(),
    ...(customModels.length === 0 ? {} : { models: customModels }),
  };
}

function openOfficialAuthUrl(authUrl: string): void {
  const url = new URL(authUrl);
  if (url.protocol !== "https:") {
    throw new Error("Official login URL must use HTTPS");
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ProviderConnectionPanel() {
  const queryClient = useQueryClient();
  const connectionQuery = useQuery(providerConnectionQueryOptions());
  const officialLogin = useMutation(startOfficialProviderLoginMutationOptions(queryClient));
  const cancelLogin = useMutation(cancelProviderLoginMutationOptions(queryClient));
  const logout = useMutation(logoutProviderMutationOptions(queryClient));
  const [mode, setMode] = useState<ConnectionMode>("official");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<readonly CustomModelDraft[]>([]);
  const nextModelKey = useRef(1);
  const [customPending, setCustomPending] = useState(false);
  const status = connectionQuery.data;

  useEffect(() => {
    if (status === undefined) return;
    setMode(status.mode);
    if (status.customBaseUrl !== null) setBaseUrl(status.customBaseUrl);
  }, [status]);

  const isBusy =
    officialLogin.isPending || cancelLogin.isPending || logout.isPending || customPending;
  const requestError = connectionQuery.error?.message ?? null;

  return (
    <ProviderConnectionPanelView
      apiKey={apiKey}
      baseUrl={baseUrl}
      error={requestError}
      isBusy={isBusy}
      mode={mode}
      models={models}
      onAddModel={() => {
        const key = `custom-model-${String(nextModelKey.current)}`;
        nextModelKey.current += 1;
        setModels((current) => [...current, { id: "", key, name: "" }]);
      }}
      onApiKeyChange={setApiKey}
      onBaseUrlChange={setBaseUrl}
      onCancelLogin={() => {
        const loginId = status?.pendingLogin?.loginId;
        if (loginId !== undefined) void cancelLogin.mutateAsync(loginId).catch(() => undefined);
      }}
      onConfigureCustom={() => {
        setCustomPending(true);
        const input = createCustomProviderInput({ apiKey, baseUrl, models });
        void configureCustomProvider(input, queryClient)
          .then(() => {
            setApiKey("");
            notifyActionSuccess();
          })
          .catch((error: unknown) => {
            notifyActionError(error);
          })
          .finally(() => {
            setApiKey("");
            setCustomPending(false);
          });
      }}
      onLogout={() => {
        void logout.mutateAsync().catch(() => undefined);
      }}
      onModelChange={(key, field, value) => {
        setModels((current) =>
          current.map((model) => (model.key === key ? { ...model, [field]: value } : model)),
        );
      }}
      onModeChange={(nextMode) => {
        setMode(nextMode);
      }}
      onRetry={() => {
        void connectionQuery.refetch();
      }}
      onRemoveModel={(key) => {
        setModels((current) => current.filter((model) => model.key !== key));
      }}
      onStartOfficialLogin={() => {
        void officialLogin
          .mutateAsync()
          .then((result) => {
            try {
              openOfficialAuthUrl(result.authUrl);
            } catch (error) {
              notifyActionError(error);
            }
          })
          .catch(() => undefined);
      }}
      status={status}
    />
  );
}
