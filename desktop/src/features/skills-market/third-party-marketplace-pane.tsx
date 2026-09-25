import type { ClawhubSkillPage, ClawhubSkillSummary, SkillInstallScope } from "@/protocol/index.js";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Blocks, Download, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { Input } from "../../shared/components/core/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/components/core/select.js";
import { useProjectData } from "../projects/project-context.js";
import { SkillDetailSheet } from "./skill-detail-sheet.js";

function useDebouncedValue(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    // 仅在输入稳定后访问 ClawHub，降低远端请求和渲染抖动。
    const timeout = window.setTimeout(() => setDebounced(value), 250);
    return () => window.clearTimeout(timeout);
  }, [value]);
  return debounced;
}

function SkillCard({ skill, onOpen }: Readonly<{ onOpen: (skill: ClawhubSkillSummary) => void; skill: ClawhubSkillSummary }>) {
  return <button className="skills-market-card" onClick={() => onOpen(skill)} type="button"><span className="skills-market-card__topline"><span className="skills-market-glyph" data-tone="marketplace" aria-hidden="true"><Blocks /></span><span className="min-w-0 flex-1 text-left"><strong className="block truncate text-body-small">{skill.displayName}</strong><span className="block truncate text-label text-muted-foreground">@{skill.owner}</span></span><span className="skills-version">v{skill.latestVersion}</span></span><span className="skills-market-card__summary">{skill.summary}</span><span className="skills-market-card__footer"><span><Download aria-hidden="true" />{skill.downloads.toLocaleString()}</span><span><Star aria-hidden="true" />{skill.stars.toLocaleString()}</span></span></button>;
}

export function ThirdPartyMarketplacePane({ projectId, rootPath }: Readonly<{ projectId?: string; rootPath?: string }>) {
  const { t } = useTranslation("workbench");
  const { client, projects } = useProjectData();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recommended");
  const [selected, setSelected] = useState<ClawhubSkillSummary | null>(null);
  const deferredQuery = useDebouncedValue(query.trim());
  const installed = useQuery({ queryFn: () => client.listInstalledSkills(), queryKey: ["extensions", "skills"] });
  const market = useInfiniteQuery({ getNextPageParam: (page: ClawhubSkillPage) => page.nextCursor ?? undefined, initialPageParam: null as string | null, queryFn: ({ pageParam }) => client.listClawhubSkills(deferredQuery, pageParam, sort), queryKey: ["extensions", "marketplace", "clawhub", deferredQuery, sort], staleTime: 2 * 60_000 });
  const install = useMutation({
    meta: { actionNotification: { successMessage: t("skillsMarket.installComplete") } },
    mutationFn: ({ projectId: targetProjectId, rootPath: targetRootPath, scope, skill }: { projectId?: string; rootPath?: string; scope: SkillInstallScope; skill: ClawhubSkillSummary }) => client.installClawhubSkill(skill.owner, skill.slug, scope, targetProjectId, targetRootPath),
    onSuccess: () => {
      setSelected(null);
      return queryClient.invalidateQueries({ queryKey: ["extensions", "skills"] });
    },
  });
  const data = market.data as InfiniteData<ClawhubSkillPage, string | null> | undefined;
  const items = data?.pages.flatMap((page) => page.items) ?? [];
  return <div className="skills-market-pane" role="tabpanel"><div className="skills-market-toolbar"><div className="skills-market-search"><Search aria-hidden="true" /><Input aria-label={t("skillsMarket.search")} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("skillsMarket.search")} value={query} /></div><Select onValueChange={setSort} value={sort}><SelectTrigger aria-label={t("skillsMarket.sort")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recommended">{t("skillsMarket.sortRecommended")}</SelectItem><SelectItem value="downloads">{t("skillsMarket.sortDownloads")}</SelectItem><SelectItem value="updated">{t("skillsMarket.sortUpdated")}</SelectItem></SelectContent></Select></div>{market.isPending ? <div className="skills-market-state" role="status">{t("skillsMarket.loadingMarket")}</div> : market.error !== null ? <div className="skills-market-state" role="alert">{t("skillsMarket.marketError")}</div> : items.length === 0 ? <div className="skills-market-state">{t("skillsMarket.emptyMarket")}</div> : <div className="skills-market-grid">{items.map((skill) => <SkillCard key={skill.id} onOpen={setSelected} skill={skill} />)}</div>}{market.hasNextPage ? <Button className="mx-auto" disabled={market.isFetchingNextPage} onClick={() => void market.fetchNextPage()} type="button" variant="outline">{t(market.isFetchingNextPage ? "skillsMarket.loading" : "skillsMarket.loadMore")}</Button> : null}{selected === null ? null : <SkillDetailSheet client={client} currentProjectId={projectId} currentRootPath={rootPath} installedSkills={installed.data?.data ?? []} installingScope={install.isPending ? install.variables?.scope ?? null : null} onClose={() => setSelected(null)} onInstall={(skill, scope, target) => install.mutate({ scope, skill, ...target })} projects={projects} skill={selected} />}</div>;
}
