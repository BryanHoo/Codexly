import { officialPluginsQueryKey, refreshPluginQueries } from "@codexly/frontend-core/plugin-reconcile";
import type {
  OfficialPluginInstallResult,
  OfficialPluginPage,
  OfficialPluginSummary,
} from "@/protocol/index.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, PlugZap, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { Input } from "../../shared/components/core/input.js";
import "../../shared/styles/official-plugins.css";
import { useProjectData } from "../projects/project-context.js";
import { OfficialPluginSheet } from "./official-plugin-sheet.js";


function OfficialPluginCard({
  onOpen,
  plugin,
}: Readonly<{
  onOpen: (plugin: OfficialPluginSummary) => void;
  plugin: OfficialPluginSummary;
}>) {
  const { t } = useTranslation("workbench");

  return (
    <button
      className="skills-market-card official-plugin-card"
      onClick={() => onOpen(plugin)}
      type="button"
    >
      <span className="skills-market-card__topline">
        {plugin.logoUrl === null ? (
          <span className="skills-market-glyph" data-tone="plugins" aria-hidden="true">
            <PlugZap />
          </span>
        ) : (
          <img className="official-plugin-card__logo" src={plugin.logoUrl} alt="" />
        )}
        <span className="min-w-0 flex-1 text-left">
          <strong className="block truncate text-body-small">{plugin.displayName}</strong>
          <span className="block truncate text-label text-muted-foreground">
            {plugin.developerName ?? t("skillsMarket.officialPublisher")}
          </span>
        </span>
        {plugin.installed ? (
          <span className="official-plugin-card__installed">
            <CheckCircle2 aria-hidden="true" />
            {t("skillsMarket.installed")}
          </span>
        ) : null}
      </span>
      <span className="skills-market-card__summary">{plugin.description}</span>
      <span className="skills-market-card__footer">
        <span>{plugin.version === null ? plugin.name : `v${plugin.version}`}</span>
      </span>
    </button>
  );
}

function OfficialPluginGroup({
  emptyLabel,
  onOpen,
  plugins,
  title,
}: Readonly<{
  emptyLabel: string;
  onOpen: (plugin: OfficialPluginSummary) => void;
  plugins: readonly OfficialPluginSummary[];
  title: string;
}>) {
  return (
    <section className="official-plugin-group">
      <header>
        <h3>{title}</h3>
        <span>{plugins.length}</span>
      </header>
      {plugins.length === 0 ? (
        <p className="official-plugin-group__empty">{emptyLabel}</p>
      ) : (
        <div className="skills-market-grid official-plugin-grid">
          {plugins.map((plugin) => (
            <OfficialPluginCard key={plugin.id} onOpen={onOpen} plugin={plugin} />
          ))}
        </div>
      )}
    </section>
  );
}

export function OfficialPluginsPane() {
  const { t } = useTranslation("workbench");
  const { client } = useProjectData();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<OfficialPluginInstallResult | null>(null);
  const [syncPartial, setSyncPartial] = useState(false);
  const plugins = useQuery({
    queryFn: () => client.listOfficialPlugins(false),
    queryKey: officialPluginsQueryKey,
    staleTime: 60_000,
  });

  // 搜索和分组仅遍历一次目录，已安装项始终优先展示。
  const groupedPlugins = useMemo(() => {
    const installed: OfficialPluginSummary[] = [];
    const available: OfficialPluginSummary[] = [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    for (const plugin of plugins.data?.data ?? []) {
      const searchable = [plugin.displayName, plugin.name, plugin.description, plugin.developerName]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      if (normalizedQuery !== "" && !searchable.includes(normalizedQuery)) continue;
      (plugin.installed ? installed : available).push(plugin);
    }
    return { available, installed };
  }, [plugins.data?.data, query]);

  const updateInstalledState = (pluginId: string, installed: boolean) => {
    queryClient.setQueryData<OfficialPluginPage>(officialPluginsQueryKey, (current) => (
      current === undefined
        ? current
        : {
            data: current.data.map((plugin) => (
              plugin.id === pluginId ? { ...plugin, enabled: installed, installed } : plugin
            )),
          }
    ));
  };
  const install = useMutation({
    mutationFn: (plugin: OfficialPluginSummary) => client.installOfficialPlugin(
      plugin.marketplaceName,
      plugin.marketplacePath,
      plugin.pluginName,
      globalThis.crypto.randomUUID(),
    ),
    onSuccess: (result, plugin) => {
      setInstallResult(result);
      updateInstalledState(plugin.id, true);
    },
  });
  const uninstall = useMutation({
    mutationFn: (plugin: OfficialPluginSummary) => client.uninstallOfficialPlugin(plugin.id),
    onSuccess: (_, plugin) => {
      setInstallResult(null);
      updateInstalledState(plugin.id, false);
    },
  });
  const selected = plugins.data?.data.find((plugin) => plugin.id === selectedId) ?? null;
  const refresh = useMutation({
    mutationFn: async () => {
      await refreshPluginQueries(client, queryClient, (result) => {
        // 界面只保留失败标记，不长期持有本次同步的插件变化列表。
        setSyncPartial(result.failedRemotePluginIds.length > 0 || result.failedMaterializationRemotePluginIds.length > 0);
        setInstallResult(null);
      });
    },
  });
  const refreshing = refresh.isPending || plugins.isFetching;


  return (
    <div className="skills-market-pane" role="tabpanel">
      <div className="skills-market-toolbar">
        <div className="skills-market-search">
          <Search aria-hidden="true" />
          <Input
            aria-label={t("skillsMarket.searchPlugins")}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("skillsMarket.searchPlugins")}
            value={query}
          />
        </div>
        <Button disabled={refreshing || install.isPending || uninstall.isPending} onClick={() => refresh.mutate()} type="button" variant="outline">
          <RefreshCw aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
          {t("skillsMarket.refreshPlugins")}
        </Button>
      </div>

      {refresh.error !== null ? (
        <div className="skills-market-state" role="alert">{t("skillsMarket.pluginSyncError")}</div>
      ) : syncPartial ? (
        <div className="skills-market-state" role="alert">{t("skillsMarket.pluginSyncPartial")}</div>
      ) : null}
      {plugins.isPending ? (
        <div className="skills-market-state" role="status">{t("skillsMarket.loadingPlugins")}</div>
      ) : plugins.error !== null ? (
        <div className="skills-market-state" role="alert">{t("skillsMarket.pluginError")}</div>
      ) : (
        <div className="official-plugin-groups">
          <OfficialPluginGroup
            emptyLabel={t("skillsMarket.emptyInstalledPlugins")}
            onOpen={(plugin) => {
              setInstallResult(null);
              setSelectedId(plugin.id);
            }}
            plugins={groupedPlugins.installed}
            title={t("skillsMarket.installedPlugins")}
          />
          <OfficialPluginGroup
            emptyLabel={t("skillsMarket.emptyAvailablePlugins")}
            onOpen={(plugin) => {
              setInstallResult(null);
              setSelectedId(plugin.id);
            }}
            plugins={groupedPlugins.available}
            title={t("skillsMarket.availablePlugins")}
          />
        </div>
      )}

      {selected === null ? null : (
        <OfficialPluginSheet
          client={client}
          installResult={installResult}
          installing={install.isPending || refresh.isPending}
          onInstall={() => install.mutate(selected)}
          onOpenChange={(open) => !open && setSelectedId(null)}
          onUninstall={() => uninstall.mutate(selected)}
          plugin={selected}
          uninstalling={uninstall.isPending || refresh.isPending}
        />
      )}
    </div>
  );
}
