import type { ConfigureCustomProviderRequest } from "@/protocol/index.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSettingsAutosave } from "@codexly/ui/core/use-settings-autosave";
import { SettingsSaveStatus } from "@codexly/ui/core/settings-save-status";
import { useTranslation } from "../../../i18n/i18n.js";
import { hasIncompleteCustomModels } from "./provider-connection-panel-view.js";

import { notifyActionError } from "../../notifications/action-notifications.js";
import {
  cancelProviderLoginMutationOptions,
  configureCustomProvider,
  logoutProviderMutationOptions,
  providerConnectionQueryOptions,
  startOfficialProviderLoginMutationOptions,
} from "../provider-connection-queries.js";
import { openOfficialAuthUrl } from "../official-auth-navigation.js";
import type { CustomModelDraft } from "./custom-model-editor.js";
import { ProviderConnectionPanelView, type ConnectionMode } from "./provider-connection-panel-view.js";

export { ProviderConnectionPanelView, hasIncompleteCustomModels } from "./provider-connection-panel-view.js";

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

export function ProviderConnectionPanel({ autoSave = false, onConnected, continueLabel }: Readonly<{ autoSave?: boolean; onConnected?: (() => void) | undefined; continueLabel?: string | undefined }> = {}) {
  const connectedRef = useRef(onConnected);
  connectedRef.current = onConnected;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
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
  const { t } = useTranslation("settings");
  const dirty = useRef(false);
  const formRef = useRef({ apiKey, baseUrl, models });
  formRef.current = { apiKey, baseUrl, models };
  const autosave = useSettingsAutosave<typeof formRef.current>(async (value) => {
    await configureCustomProvider(createCustomProviderInput(value), queryClient);
    // 保存期间允许继续输入，较早响应只能清空其对应的密钥，失败保留输入供重试。
    if (formRef.current.apiKey === value.apiKey) setApiKey("");
    if (formRef.current.baseUrl === value.baseUrl && formRef.current.models === value.models) dirty.current = false;
    if (active.current) connectedRef.current?.();
  });
  const update = (patch: Partial<typeof formRef.current>, immediate = false) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    dirty.current = true;
    setApiKey(next.apiKey);
    setBaseUrl(next.baseUrl);
    setModels(next.models);
    let valid = false;
    try { valid = ["http:", "https:"].includes(new URL(next.baseUrl).protocol); } catch { /* 未输入完整的地址暂不提交。 */ }
    if (!valid || hasIncompleteCustomModels(next.models)) { autosave.queue.cancelScheduled(); return; }
    if (!autoSave) return;
    if (immediate) autosave.queue.save(next);
    else autosave.queue.schedule(next);
  };
  const status = connectionQuery.data;

  useEffect(() => {
    if (status === undefined || dirty.current) return;
    setMode(status.mode);
    if (status.customBaseUrl !== null) setBaseUrl(status.customBaseUrl);
  }, [status]);

  useEffect(() => {
    if (status?.state === "connected" && status.mode === mode && !dirty.current) connectedRef.current?.();
  }, [status, mode]);

  useEffect(() => {
    if (status?.state === "connected" || status?.state === "disconnected") {
      window.dispatchEvent(new Event("codexly:engine-settings-changed"));
    }
  }, [status?.state]);

  const isBusy =
    officialLogin.isPending || cancelLogin.isPending || logout.isPending || (!autoSave && autosave.status === "saving");
  const requestError = connectionQuery.error?.message ?? null;

  return (
    <>
    <SettingsSaveStatus beforeLeave={() => autosave.queue.flush()} status={autosave.status} labels={{ saving: t("actions.saving"), saved: t("actions.saved"), saveError: t("errors.save"), retry: t("common:actions.retry") }} onRetry={() => { void autosave.queue.retry(); }} />
    <ProviderConnectionPanelView
      setup={Boolean(onConnected)}
      continueLabel={continueLabel}
      autoSave={autoSave}
      apiKey={apiKey}
      baseUrl={baseUrl}
      error={requestError}
      isBusy={isBusy}
      mode={mode}
      models={models}
      onAddModel={() => {
        const key = `custom-model-${String(nextModelKey.current)}`;
        nextModelKey.current += 1;
        update({ models: [...formRef.current.models, { id: "", key, name: "" }] });
      }}
      onApiKeyChange={(apiKey) => update({ apiKey })}
      onBaseUrlChange={(baseUrl) => update({ baseUrl })}
      onCancelLogin={() => {
        const loginId = status?.pendingLogin?.loginId;
        if (loginId !== undefined) void cancelLogin.mutateAsync(loginId).catch(() => undefined);
      }}
      onConfigureCustom={() => {
        if (onConnected && !dirty.current && status?.state === "connected") { onConnected(); return; }
        if (!autoSave) autosave.queue.save(formRef.current);
        void autosave.queue.flush();
      }}
      onLogout={() => {
        void logout.mutateAsync().catch(() => undefined);
      }}
      onModelChange={(key, field, value) => {
        update({ models: formRef.current.models.map((model) => model.key === key ? { ...model, [field]: value } : model) });
      }}
      onModeChange={(nextMode) => {
        setMode(nextMode);
      }}
      onRetry={() => {
        void connectionQuery.refetch();
      }}
      onRemoveModel={(key) => {
        update({ models: formRef.current.models.filter((model) => model.key !== key) }, true);
      }}
      onStartOfficialLogin={() => {
        void officialLogin
          .mutateAsync()
          .then(async (result) => {
            try {
              await openOfficialAuthUrl(result.authUrl);
            } catch (error) {
              notifyActionError(error);
            }
          })
          .catch(() => undefined);
      }}
      status={status}
    />
    </>
  );
}
