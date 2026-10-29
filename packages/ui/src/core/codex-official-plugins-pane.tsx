import { LoadingSkeleton } from "./loading-skeleton.js";
import { useDeferredValue, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Download, Info, LoaderCircle, Trash2 } from "lucide-react";
import {
  officialPluginsQueryKey,
  refreshPluginQueries,
} from "@codexly/frontend-core/plugin-reconcile";
import type {
  OfficialPluginInstallResult,
  OfficialPluginPage,
  OfficialPluginSummary,
  PluginReconcileResult,
} from "@codexly/protocol";
import { Button } from "./button.js";
import {
  ExtensionCatalogToolbar,
  ExtensionItem,
  ExtensionRemoveDialog,
} from "./extension-catalog.js";
import { ExtensionList } from "./extension-list.js";
import { useExtensionOperation } from "./extension-operation.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";
import type { ExtensionTranslate } from "./extension-center-types.js";

export type CodexPluginDetailsProps = Readonly<{
  plugin: OfficialPluginSummary;
  installResult: OfficialPluginInstallResult | null;
  installing: boolean;
  uninstalling: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onOpenChange: (open: boolean) => void;
}>;
interface CatalogClient {
  listOfficialPlugins(force: boolean): Promise<OfficialPluginPage>;
  reconcileOfficialPlugins(): Promise<PluginReconcileResult>;
}
interface Input {
  id: string;
  plugin: OfficialPluginSummary;
  action: "install" | "uninstall";
}
interface Result {
  plugins?: OfficialPluginPage;
  installation?: OfficialPluginInstallResult;
}

/** Codex 保留原生安装和授权契约，列表、行内操作和反馈与 Claude 共用同一套组件。 */
export function CodexOfficialPluginsPane({
  client,
  installPlugin,
  uninstallPlugin,
  renderDetails,
  t,
}: Readonly<{
  client: CatalogClient;
  installPlugin: (
    plugin: OfficialPluginSummary,
  ) => Promise<OfficialPluginInstallResult & { plugins?: OfficialPluginPage }>;
  uninstallPlugin: (plugin: OfficialPluginSummary) => Promise<{ plugins?: OfficialPluginPage }>;
  renderDetails: (props: CodexPluginDetailsProps) => ReactNode;
  t: ExtensionTranslate;
}>) {
  const cache = useQueryClient();
  const plugins = useQuery({
    queryKey: officialPluginsQueryKey,
    queryFn: () => client.listOfficialPlugins(false),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OfficialPluginSummary | null>(null);
  const [installations, setInstallations] = useState(
    new Map<string, OfficialPluginInstallResult>(),
  );
  const [notice, setNotice] = useState(false);
  const [syncPartial, setSyncPartial] = useState(false);
  const operations = useExtensionOperation<Input, Result>({
    mutationKey: [...officialPluginsQueryKey, "operations"],
    mutationFn: async (input) => {
      await cache.cancelQueries({ queryKey: officialPluginsQueryKey, exact: true });
      if (input.action === "install") {
        const installation = await installPlugin(input.plugin);
        return { ...(installation.plugins ? { plugins: installation.plugins } : {}), installation };
      }
      return uninstallPlugin(input.plugin);
    },
    onSuccess: async (result, input) => {
      await cache.cancelQueries({ queryKey: officialPluginsQueryKey, exact: true });
      // Web 返回权威目录，桌面返回安装结果；两者只合并当前插件，避免并行请求互相覆盖。
      cache.setQueryData<OfficialPluginPage>(officialPluginsQueryKey, (previous) =>
        previous
          ? {
              data: previous.data.map((plugin) =>
                plugin.id === input.id
                  ? (result.plugins?.data.find((item) => item.id === input.id) ?? {
                      ...plugin,
                      installed: input.action === "install",
                      enabled: input.action === "install",
                    })
                  : plugin,
              ),
            }
          : result.plugins,
      );
      void cache.invalidateQueries({
        queryKey: [
          ...officialPluginsQueryKey,
          "detail",
          input.plugin.marketplaceName,
          input.plugin.marketplacePath,
          input.plugin.pluginName,
        ],
      });
      setNotice(true);
      setDialog((current) => (current?.id === input.id ? null : current));
      setInstallations((current) => {
        const next = new Map(current);
        if (result.installation) next.set(input.id, result.installation);
        else next.delete(input.id);
        return next;
      });
      // 只有需要授权时才自动打开详情；普通安装直接在当前行完成。
      if (result.installation?.appsNeedingAuth.length)
        setSelectedId((current) => current ?? input.id);
      else if (input.action === "uninstall")
        setSelectedId((current) => (current === input.id ? null : current));
    },
  });
  const sync = useMutation({
    mutationFn: () =>
      refreshPluginQueries(client, cache, (result) => {
        setSyncPartial(
          result.failedRemotePluginIds.length > 0 ||
            result.failedMaterializationRemotePluginIds.length > 0,
        );
        setNotice(false);
      }),
  });
  const rows = (plugins.data?.data ?? []).filter(
    (plugin) =>
      (!query ||
        `${plugin.displayName} ${plugin.name} ${plugin.description} ${plugin.developerName ?? ""}`
          .toLowerCase()
          .includes(query)) &&
      (filter !== "installed" || plugin.installed) &&
      (filter !== "available" || !plugin.installed),
  );
  const selected = plugins.data?.data.find((plugin) => plugin.id === selectedId);
  const error =
    operations.error?.message ??
    (sync.error
      ? t("skillsMarket.pluginSyncError")
      : plugins.error
        ? t("skillsMarket.pluginError")
        : syncPartial
          ? t("skillsMarket.pluginSyncPartial")
          : "");
  const run = (plugin: OfficialPluginSummary, action: Input["action"]) => {
    void operations.run({ id: plugin.id, plugin, action });
  };
  return (
    <div className="skills-market-pane" aria-busy={plugins.isFetching}>
      <ExtensionCatalogToolbar
        search={search}
        onSearch={setSearch}
        count={plugins.data?.data.length ?? 0}
        loading={plugins.isFetching}
        onRefresh={() => {
          operations.clearError();
          void plugins.refetch();
        }}
        filter={filter}
        onFilter={setFilter}
        syncing={sync.isPending}
        onSync={() => {
          sync.mutate();
        }}
        t={t}
      />
      {error ? (
        <div className="extension-center__message" role="alert">
          <Info aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="extension-center__message" role="status">
          <Info aria-hidden="true" />
          {t("skillsMarket.center.sessionHint")}
        </div>
      ) : null}
      {plugins.isPending ? (
        <LoadingSkeleton label={t("skillsMarket.loadingExtension")} />
      ) : rows.length ? (
        <ExtensionList
          items={rows}
          renderItem={(plugin) => {
            const pending = operations.pendingIds.has(plugin.id);
            const unavailable =
              plugin.installPolicy === "NOT_AVAILABLE" || plugin.availability !== "AVAILABLE";
            return (
              <ExtensionItem
                key={plugin.id}
                kind="plugins"
                name={plugin.displayName}
                description={plugin.description || t("skillsMarket.pluginFallbackDescription")}
                scopeLabel={t("skillsMarket.center.global")}
                version={plugin.localVersion ?? plugin.version ?? undefined}
                onOpen={() => {
                  setSelectedId(plugin.id);
                }}
                openLabel={t("skillsMarket.pluginDetails", { name: plugin.displayName })}
                actions={
                  <>
                    {!plugin.installed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex" tabIndex={unavailable ? 0 : undefined}>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending || unavailable}
                              aria-busy={pending}
                              onClick={() => {
                                run(plugin, "install");
                              }}
                            >
                              {pending ? (
                                <LoaderCircle className="animate-spin" aria-hidden="true" />
                              ) : (
                                <Download aria-hidden="true" />
                              )}
                              {t("skillsMarket.installPlugin")}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {unavailable
                            ? (plugin.disabledReason ?? t("skillsMarket.pluginUnavailable"))
                            : t("skillsMarket.installPlugin")}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <>
                        {installations.get(plugin.id)?.appsNeedingAuth.length ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedId(plugin.id);
                            }}
                          >
                            {t("skillsMarket.authorize")}
                          </Button>
                        ) : null}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`${t("skillsMarket.center.remove")} ${plugin.displayName}`}
                              disabled={pending}
                              onClick={() => {
                                setDialog(plugin);
                              }}
                            >
                              {pending ? (
                                <LoaderCircle className="animate-spin" aria-hidden="true" />
                              ) : (
                                <Trash2 aria-hidden="true" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("skillsMarket.center.remove")}</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </>
                }
              />
            );
          }}
        />
      ) : !error ? (
        <div className="extension-empty">
          <BadgeCheck aria-hidden="true" />
          <h4>{t(query ? "skillsMarket.center.noResults" : "skillsMarket.emptyPlugins")}</h4>
          <p>{t(query ? "skillsMarket.center.searchHint" : "skillsMarket.pluginCatalogHint")}</p>
        </div>
      ) : null}
      {dialog ? (
        <ExtensionRemoveDialog
          name={dialog.displayName}
          pending={operations.pendingIds.has(dialog.id)}
          error={error}
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            run(dialog, "uninstall");
          }}
          t={t}
        />
      ) : null}
      {selected
        ? renderDetails({
            plugin: selected,
            installResult: installations.get(selected.id) ?? null,
            installing: operations.pendingIds.has(selected.id),
            uninstalling: operations.pendingIds.has(selected.id),
            onInstall: () => {
              run(selected, "install");
            },
            onUninstall: () => {
              setDialog(selected);
            },
            onOpenChange: (open) => {
              if (!open) setSelectedId(null);
            },
          })
        : null}
    </div>
  );
}
