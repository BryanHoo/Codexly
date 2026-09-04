import type {
  ClawhubSkillPage,
  ClawhubSkillSummary,
  ConfiguredMcpServer,
  InstalledSkill,
  SkillInstallScope,
} from "@codexly/protocol";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Blocks, Download, FolderOpen, RefreshCw, Search, Server, Star } from "lucide-react";
import { Switch } from "radix-ui";
import { useEffect, useMemo, useState } from "react";

import "../../shared/styles/skills-market.css";
import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { Input } from "../../shared/components/core/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/components/core/select.js";
import { useProjectData } from "../projects/project-context.js";
import { SkillDetailDialog } from "./skill-detail-dialog.js";

type MarketTab = "installed" | "market" | "mcp";

function useDebouncedValue(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    // 输入稳定后再查询远端目录，减少无效请求和列表抖动。
    const timeout = window.setTimeout(() => {
      setDebounced(value);
    }, 250);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [value]);
  return debounced;
}

function InstalledRow({
  open,
  pending,
  skill,
  toggle,
}: Readonly<{
  open: (skill: InstalledSkill) => void;
  pending: boolean;
  skill: InstalledSkill;
  toggle: (skill: InstalledSkill) => void;
}>) {
  const { t } = useTranslation("workbench");
  return (
    <li className="skills-installed-row">
      <button
        aria-label={t("skillsMarket.openSkill", { name: skill.displayName })}
        className="skills-installed-row__open"
        onClick={() => {
          open(skill);
        }}
        type="button"
      >
        <span aria-hidden="true" className="skills-market-glyph">
          <Blocks />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-body-small">{skill.displayName}</strong>
          <span className="block truncate text-label text-muted-foreground" title={skill.path}>
            {skill.description || skill.path}
          </span>
        </span>
        <FolderOpen aria-hidden="true" className="skills-installed-row__folder" />
      </button>
      <Switch.Root
        aria-label={t("skillsMarket.toggle", { name: skill.displayName })}
        checked={skill.enabled}
        className="skills-switch"
        disabled={pending}
        onCheckedChange={() => {
          toggle(skill);
        }}
      >
        <Switch.Thumb className="skills-switch__thumb" />
      </Switch.Root>
    </li>
  );
}

function SkillCard({
  onOpen,
  skill,
}: Readonly<{
  onOpen: (skill: ClawhubSkillSummary) => void;
  skill: ClawhubSkillSummary;
}>) {
  return (
    <button
      className="skills-market-card"
      onClick={() => {
        onOpen(skill);
      }}
      type="button"
    >
      <span className="skills-market-card__topline">
        <span aria-hidden="true" className="skills-market-glyph">
          <Blocks />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <strong className="block truncate text-body-small">{skill.displayName}</strong>
          <span className="block truncate text-label text-muted-foreground">@{skill.owner}</span>
        </span>
        <span className="skills-version">v{skill.latestVersion}</span>
      </span>
      <span className="skills-market-card__summary">{skill.summary}</span>
      <span className="skills-market-card__footer">
        <span>
          <Download aria-hidden="true" />
          {skill.downloads.toLocaleString()}
        </span>
        <span>
          <Star aria-hidden="true" />
          {skill.stars.toLocaleString()}
        </span>
      </span>
    </button>
  );
}

function McpServerRow({
  pending,
  server,
  toggle,
}: Readonly<{
  pending: boolean;
  server: ConfiguredMcpServer;
  toggle: (server: ConfiguredMcpServer) => void;
}>) {
  const { t } = useTranslation("workbench");
  return (
    <li className="skills-installed-row">
      <span className="skills-mcp-row__content">
        <span aria-hidden="true" className="skills-market-glyph">
          <Server />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-body-small">{server.name}</strong>
          <span className="skills-mcp-status" data-enabled={server.enabled}>
            {t(server.enabled ? "skillsMarket.mcpEnabled" : "skillsMarket.mcpStopped")}
          </span>
        </span>
      </span>
      <Switch.Root
        aria-label={t("skillsMarket.toggleMcp", { name: server.name })}
        checked={server.enabled}
        className="skills-switch"
        disabled={pending}
        onCheckedChange={() => {
          toggle(server);
        }}
      >
        <Switch.Thumb className="skills-switch__thumb" />
      </Switch.Root>
    </li>
  );
}

export function SkillsMarketContainer({
  projectId,
  rootPath,
}: Readonly<{
  projectId?: string;
  rootPath?: string;
}>) {
  const { t } = useTranslation("workbench");
  const { client, projects } = useProjectData();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<MarketTab>("installed");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recommended");
  const [selected, setSelected] = useState<ClawhubSkillSummary | null>(null);
  const deferredQuery = useDebouncedValue(query.trim());
  const installed = useQuery({
    queryFn: () => client.listInstalledSkills(),
    queryKey: ["skills-market", "installed"],
  });
  const market = useInfiniteQuery({
    enabled: tab === "market",
    getNextPageParam: (page: ClawhubSkillPage) => page.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<ClawhubSkillPage> =>
      client.listClawhubSkills(deferredQuery, pageParam, sort),
    queryKey: ["skills-market", "catalog", deferredQuery, sort],
    staleTime: 2 * 60_000,
  });
  const mcpServers = useQuery({
    enabled: tab === "mcp",
    queryFn: () => client.listConfiguredMcpServers(),
    queryKey: ["skills-market", "mcp"],
  });
  const toggle = useMutation({
    mutationFn: (skill: InstalledSkill) => client.setSkillEnabled(skill.path, !skill.enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills-market", "installed"] }),
  });
  const openSkill = useMutation({
    meta: { actionNotification: { successMessage: false } },
    mutationFn: (path: string) => client.openSkillDirectory(path),
  });
  const toggleMcp = useMutation({
    mutationFn: (server: ConfiguredMcpServer) =>
      client.setMcpServerEnabled(server.name, !server.enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills-market", "mcp"] }),
  });
  const install = useMutation({
    meta: { actionNotification: { successMessage: t("skillsMarket.installComplete") } },
    mutationFn: ({
      projectId: targetProjectId,
      rootPath: targetRootPath,
      scope,
      skill,
    }: {
      projectId?: string;
      rootPath?: string;
      scope: SkillInstallScope;
      skill: ClawhubSkillSummary;
    }) =>
      client.installClawhubSkill(skill.owner, skill.slug, scope, targetProjectId, targetRootPath),
    onSuccess: () => {
      // 成功后关闭详情并刷新本地发现结果；失败时保留弹窗供用户重试。
      setSelected(null);
      return queryClient.invalidateQueries({ queryKey: ["skills-market", "installed"] });
    },
  });
  const groups = useMemo(() => {
    const system: InstalledSkill[] = [];
    const global: InstalledSkill[] = [];
    const unassignedProject: InstalledSkill[] = [];
    const projectSkills = new Map(projects.map((project) => [project.id, [] as InstalledSkill[]]));
    for (const skill of installed.data?.data ?? []) {
      if (skill.scope === "system" || skill.scope === "admin") system.push(skill);
      else if (skill.scope === "user") global.push(skill);
      else if (skill.projectId !== undefined) {
        (projectSkills.get(skill.projectId) ?? unassignedProject).push(skill);
      } else unassignedProject.push(skill);
    }
    return [
      { id: "system", skills: system, title: t("skillsMarket.scope.system") },
      { id: "global", skills: global, title: t("skillsMarket.scope.user") },
      ...projects.map((project) => ({
        id: `project:${project.id}`,
        skills: projectSkills.get(project.id) ?? [],
        title: project.name,
      })),
      { id: "project:unassigned", skills: unassignedProject, title: t("skillsMarket.scope.repo") },
    ].filter((group) => group.skills.length > 0);
  }, [installed.data, projects, t]);
  const marketData = market.data as InfiniteData<ClawhubSkillPage, string | null> | undefined;
  const marketItems = marketData?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section aria-label={t("skillsMarket.title")} className="skills-market">
      <div className="skills-market-hero">
        <div>
          <span className="skills-market-eyebrow">CODEX EXTENSIONS</span>
          <h2>{t("skillsMarket.title")}</h2>
        </div>
        <div className="skills-market-tabs" role="tablist">
          {(["installed", "market", "mcp"] as const).map((item) => (
            <button
              aria-selected={tab === item}
              key={item}
              onClick={() => {
                setTab(item);
              }}
              role="tab"
              type="button"
            >
              {t(`skillsMarket.tabs.${item}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === "installed" ? (
        <div className="skills-market-pane">
          <div className="skills-market-toolbar">
            <span className="text-body-small text-muted-foreground">
              {t("skillsMarket.installedCount", { count: installed.data?.data.length ?? 0 })}
            </span>
            <Button
              aria-label={t("skillsMarket.refresh")}
              disabled={installed.isFetching}
              onClick={() => void installed.refetch()}
              size="icon-sm"
              title={t("skillsMarket.refresh")}
              type="button"
              variant="ghost"
            >
              <RefreshCw
                aria-hidden="true"
                className={installed.isFetching ? "animate-spin" : ""}
              />
            </Button>
          </div>
          {installed.isPending ? (
            <div className="skills-market-state" role="status">
              {t("skillsMarket.loading")}
            </div>
          ) : installed.error !== null ? (
            <div className="skills-market-state" role="alert">
              {t("skillsMarket.loadError")}
            </div>
          ) : groups.length === 0 ? (
            <div className="skills-market-state">{t("skillsMarket.emptyInstalled")}</div>
          ) : (
            <div className="skills-installed-groups">
              {groups.map((group) => (
                <section className="skills-installed-group" key={group.id}>
                  <header>
                    <h3>{group.title}</h3>
                    <span>{group.skills.length}</span>
                  </header>
                  <ul>
                    {group.skills.map((skill) => (
                      <InstalledRow
                        key={skill.id}
                        open={(item) => {
                          openSkill.mutate(item.path);
                        }}
                        pending={toggle.isPending && toggle.variables.id === skill.id}
                        skill={skill}
                        toggle={(item) => {
                          toggle.mutate(item);
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      ) : tab === "market" ? (
        <div className="skills-market-pane">
          <div className="skills-market-toolbar skills-market-toolbar--sticky">
            <div className="skills-market-search">
              <Search aria-hidden="true" />
              <Input
                aria-label={t("skillsMarket.search")}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                }}
                placeholder={t("skillsMarket.search")}
                value={query}
              />
            </div>
            <Select onValueChange={setSort} value={sort}>
              <SelectTrigger aria-label={t("skillsMarket.sort")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recommended">{t("skillsMarket.sortRecommended")}</SelectItem>
                <SelectItem value="downloads">{t("skillsMarket.sortDownloads")}</SelectItem>
                <SelectItem value="updated">{t("skillsMarket.sortUpdated")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {market.isPending ? (
            <div className="skills-market-state" role="status">
              {t("skillsMarket.loadingMarket")}
            </div>
          ) : market.error !== null ? (
            <div className="skills-market-state" role="alert">
              {t("skillsMarket.marketError")}
            </div>
          ) : marketItems.length === 0 ? (
            <div className="skills-market-state">{t("skillsMarket.emptyMarket")}</div>
          ) : (
            <div className="skills-market-grid">
              {marketItems.map((skill) => (
                <SkillCard key={skill.id} onOpen={setSelected} skill={skill} />
              ))}
            </div>
          )}
          {market.hasNextPage ? (
            <Button
              className="mx-auto"
              disabled={market.isFetchingNextPage}
              onClick={() => void market.fetchNextPage()}
              type="button"
              variant="outline"
            >
              {t(market.isFetchingNextPage ? "skillsMarket.loading" : "skillsMarket.loadMore")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="skills-market-pane">
          <div className="skills-market-toolbar">
            <span className="text-body-small text-muted-foreground">
              {t("skillsMarket.mcpCount", { count: mcpServers.data?.data.length ?? 0 })}
            </span>
            <Button
              aria-label={t("skillsMarket.refreshMcp")}
              disabled={mcpServers.isFetching}
              onClick={() => void mcpServers.refetch()}
              size="icon-sm"
              title={t("skillsMarket.refreshMcp")}
              type="button"
              variant="ghost"
            >
              <RefreshCw
                aria-hidden="true"
                className={mcpServers.isFetching ? "animate-spin" : ""}
              />
            </Button>
          </div>
          {mcpServers.isPending ? (
            <div className="skills-market-state" role="status">
              {t("skillsMarket.loadingMcp")}
            </div>
          ) : mcpServers.error !== null ? (
            <div className="skills-market-state" role="alert">
              {t("skillsMarket.mcpError")}
            </div>
          ) : mcpServers.data.data.length === 0 ? (
            <div className="skills-market-state">{t("skillsMarket.emptyMcp")}</div>
          ) : (
            <section className="skills-installed-group">
              <header>
                <h3>MCP</h3>
                <span>{mcpServers.data.data.length}</span>
              </header>
              <ul>
                {mcpServers.data.data.map((server) => (
                  <McpServerRow
                    key={server.name}
                    pending={toggleMcp.isPending && toggleMcp.variables.name === server.name}
                    server={server}
                    toggle={(item) => {
                      toggleMcp.mutate(item);
                    }}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {selected === null ? null : (
        <SkillDetailDialog
          client={client}
          currentProjectId={projectId}
          currentRootPath={rootPath}
          installedSkills={installed.data?.data ?? []}
          installingScope={install.isPending ? install.variables.scope : null}
          onClose={() => {
            setSelected(null);
          }}
          onInstall={(skill, scope, target) => {
            install.mutate({ scope, skill, ...target });
          }}
          projects={projects}
          skill={selected}
        />
      )}
    </section>
  );
}
