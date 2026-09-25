import type { ConfigureCustomProviderRequest } from "@/protocol/index.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { notifyActionError, notifyActionSuccess } from "../../notifications/action-notifications.js";
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
  );
}
