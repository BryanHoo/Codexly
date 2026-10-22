import { formatDisplayPath } from "@codexly/frontend-core/display-path";
import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { Blocks, Info, Server } from "lucide-react";
import type { ConfiguredMcpServerPage, InstalledSkill } from "@codexly/protocol";
import { ExtensionCatalogToolbar, ExtensionItem, ExtensionToggle } from "./extension-catalog.js";
import { ExtensionList } from "./extension-list.js";
import { useExtensionOperation } from "./extension-operation.js";
import { useExtensionProject } from "./extension-project-scope.js";
import type { ExtensionTranslate } from "./extension-center-types.js";

type ManagedSkill = Omit<InstalledSkill, "scope"> & { scope: string };
interface SkillsClient {
  listInstalledSkills(): Promise<{ data: readonly ManagedSkill[] }>;
  setSkillEnabled(path: string, enabled: boolean): Promise<{ effectiveEnabled: boolean }>;
  openSkillDirectory(path: string): Promise<unknown>;
}
interface McpClient {
  listConfiguredMcpServers(options?: { projectId?: string }): Promise<ConfiguredMcpServerPage>;
  setMcpServerEnabled(name: string, enabled: boolean): Promise<{ enabled: boolean }>;
}
type Item<Source> = Readonly<{
  id: string;
  name: string;
  description: string;
  scope: string;
  path?: string;
  enabled: boolean;
  mutable: boolean;
  source: Source;
}>;

/** 两端只注入客户端；范围隔离和列表交互统一在共享层执行。 */
export function CodexSkillsPane({ client, t }: { client: SkillsClient; t: ExtensionTranslate }) {
  const projectId = useExtensionProject();
  return (
    <CodexResourcePane
      kind="skills"
      t={t}
      queryKey={["extensions", "skills"]}
      load={() => client.listInstalledSkills()}
      normalize={(skill) => {
        if (
          projectId
            ? skill.scope !== "repo" || skill.projectId !== projectId
            : skill.scope === "repo"
        )
          return undefined;
        return {
          id: skill.id,
          name: skill.displayName,
          description: skill.description || formatDisplayPath(skill.path),
          path: skill.path,
          scope: skill.scope,
          enabled: skill.enabled,
          mutable: true,
          source: skill,
        };
      }}
      toggle={async (skill) =>
        (await client.setSkillEnabled(skill.path, !skill.enabled)).effectiveEnabled
      }
      onOpen={(skill) => client.openSkillDirectory(skill.path)}
    />
  );
}

export function CodexMcpPane({ client, t }: { client: McpClient; t: ExtensionTranslate }) {
  const projectId = useExtensionProject();
  return (
    <CodexResourcePane
      kind="mcp"
      t={t}
      queryKey={["extensions", "mcp", projectId ?? "global"]}
      load={() => client.listConfiguredMcpServers(projectId ? { projectId } : {})}
      normalize={(server) => ({
        id: server.name,
        name: server.name,
        description: "MCP",
        scope: projectId ? "repo" : "user",
        enabled: server.enabled,
        mutable: server.mutable !== false,
        source: server,
      })}
      toggle={async (server) =>
        (await client.setMcpServerEnabled(server.name, !server.enabled)).enabled
      }
    />
  );
}

function CodexResourcePane<Source extends { enabled: boolean }>({
  kind,
  t,
  queryKey,
  load,
  normalize,
  toggle,
  onOpen,
}: {
  kind: "skills" | "mcp";
  t: ExtensionTranslate;
  queryKey: QueryKey;
  load: () => Promise<{ data: readonly Source[] }>;
  normalize: (source: Source) => Item<Source> | undefined;
  toggle: (source: Source) => Promise<boolean>;
  onOpen?: (source: Source) => Promise<unknown>;
}) {
  const cache = useQueryClient();
  const result = useQuery({
    queryKey,
    queryFn: load,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());
  const [notice, setNotice] = useState(false);
  const operations = useExtensionOperation({
    mutationKey: [...queryKey, "operations"],
    mutationFn: (item: Item<Source>) => toggle(item.source),
    onSuccess: async (enabled, item) => {
      await cache.cancelQueries({ queryKey, exact: true });
      // 仅更新本条扩展，避免同时操作其他条目时用旧目录覆盖已确认状态。
      cache.setQueryData<{ data: readonly Source[] }>(queryKey, (previous) =>
        previous
          ? {
              ...previous,
              data: previous.data.map((source) =>
                normalize(source)?.id === item.id ? { ...source, enabled } : source,
              ),
            }
          : previous,
      );
      setNotice(true);
    },
  });
  const open = useMutation({
    meta: { actionNotification: { successMessage: false } },
    mutationFn: (item: Item<Source>) => onOpen?.(item.source) ?? Promise.resolve(),
  });
  const items = useMemo(
    () =>
      (result.data?.data ?? []).flatMap((source) => {
        const item = normalize(source);
        return item ? [item] : [];
      }),
    [result.data, normalize],
  );
  const rows = items.filter(
    (item) => !query || `${item.name} ${item.description}`.toLowerCase().includes(query),
  );
  const cause = operations.error ?? open.error ?? result.error;
  const Icon = kind === "skills" ? Blocks : Server;
  return (
    <div className="skills-market-pane" aria-busy={result.isFetching}>
      <ExtensionCatalogToolbar
        search={search}
        onSearch={setSearch}
        count={items.length}
        loading={result.isFetching}
        onRefresh={() => {
          operations.clearError();
          open.reset();
          void result.refetch();
        }}
        t={t}
      />
      {cause ? (
        <div className="extension-center__message" role="alert">
          <Info aria-hidden="true" />
          <span>
            {cause instanceof Error ? cause.message : t("skillsMarket.center.operationError")}
          </span>
        </div>
      ) : null}
      {notice ? (
        <div className="extension-center__message" role="status">
          <Info aria-hidden="true" />
          {t("skillsMarket.center.sessionHint")}
        </div>
      ) : null}
      {result.isPending ? (
        <div className="skills-market-state" role="status">
          {t("skillsMarket.loadingExtension")}
        </div>
      ) : rows.length ? (
        <ExtensionList
          items={rows}
          renderItem={(item) => (
            <ExtensionItem
              key={item.id}
              kind={kind}
              name={item.name}
              description={item.description}
              hint={formatDisplayPath(item.path)}
              scopeLabel={t(
                item.scope === "repo"
                  ? "skillsMarket.center.project"
                  : item.scope === "user"
                    ? "skillsMarket.center.global"
                    : `skillsMarket.scope.${item.scope}`,
              )}
              onOpen={
                onOpen
                  ? () => {
                      open.mutate(item);
                    }
                  : undefined
              }
              openLabel={t("skillsMarket.openSkill", { name: item.name })}
              actions={
                <ExtensionToggle
                  checked={item.enabled}
                  disabled={!item.mutable || operations.pendingIds.has(item.id)}
                  label={t(kind === "mcp" ? "skillsMarket.toggleMcp" : "skillsMarket.toggle", {
                    name: item.name,
                  })}
                  hint={t(
                    !item.mutable
                      ? "skillsMarket.projectMcpReadOnly"
                      : kind === "mcp"
                        ? "skillsMarket.toggleMcp"
                        : "skillsMarket.toggle",
                    { name: item.name },
                  )}
                  onChange={() => void operations.run(item)}
                />
              }
            />
          )}
        />
      ) : !cause ? (
        <div className="extension-empty">
          <Icon aria-hidden="true" />
          <h4>
            {t(
              query
                ? "skillsMarket.center.noResults"
                : kind === "skills"
                  ? "skillsMarket.emptyInstalled"
                  : "skillsMarket.emptyMcp",
            )}
          </h4>
          <p>{t(query ? "skillsMarket.center.searchHint" : "skillsMarket.resourceEmptyHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
