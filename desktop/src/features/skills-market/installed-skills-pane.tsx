import type { InstalledSkill } from "@/protocol/index.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, FolderOpen, RefreshCw } from "lucide-react";
import { Switch } from "radix-ui";
import { useMemo } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { useProjectData } from "../projects/project-context.js";

function InstalledRow({ pending, skill, onOpen, onToggle }: Readonly<{ onOpen: (skill: InstalledSkill) => void; onToggle: (skill: InstalledSkill) => void; pending: boolean; skill: InstalledSkill }>) {
  const { t } = useTranslation("workbench");
  return <li className="skills-installed-row"><button className="skills-installed-row__open" aria-label={t("skillsMarket.openSkill", { name: skill.displayName })} onClick={() => onOpen(skill)} type="button"><span className="skills-market-glyph" data-tone="skills" aria-hidden="true"><Blocks /></span><span className="min-w-0 flex-1"><strong className="block truncate text-body-small">{skill.displayName}</strong><span className="block truncate text-label text-muted-foreground" title={skill.path}>{skill.description || skill.path}</span></span><FolderOpen aria-hidden="true" className="skills-installed-row__folder" /></button><Switch.Root aria-label={t("skillsMarket.toggle", { name: skill.displayName })} checked={skill.enabled} className="skills-switch" disabled={pending} onCheckedChange={() => onToggle(skill)}><Switch.Thumb className="skills-switch__thumb" /></Switch.Root></li>;
}

export function InstalledSkillsPane() {
  const { t } = useTranslation("workbench");
  const { client, projects } = useProjectData();
  const queryClient = useQueryClient();
  const installed = useQuery({ queryFn: () => client.listInstalledSkills(), queryKey: ["extensions", "skills"] });
  const toggle = useMutation({ mutationFn: (skill: InstalledSkill) => client.setSkillEnabled(skill.path, !skill.enabled), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["extensions", "skills"] }) });
  const open = useMutation({ meta: { actionNotification: { successMessage: false } }, mutationFn: (path: string) => client.openSkillDirectory(path) });
  const groups = useMemo(() => {
    const buckets = new Map<string, { id: string; skills: InstalledSkill[]; title: string }>();
    buckets.set("system", { id: "system", skills: [], title: t("skillsMarket.scope.system") });
    buckets.set("user", { id: "user", skills: [], title: t("skillsMarket.scope.user") });
    for (const project of projects) {
      buckets.set(project.id, { id: project.id, skills: [], title: project.name });
    }
    buckets.set("repo", { id: "repo", skills: [], title: t("skillsMarket.scope.repo") });
    for (const skill of installed.data?.data ?? []) {
      if (skill.scope === "system" || skill.scope === "admin") buckets.get("system")?.skills.push(skill);
      else if (skill.scope === "user") buckets.get("user")?.skills.push(skill);
      else buckets.get(skill.projectId ?? "repo")?.skills.push(skill);
    }
    return [...buckets.values()].filter((group) => group.skills.length > 0);
  }, [installed.data, projects, t]);
  return <div className="skills-market-pane" role="tabpanel"><div className="skills-market-toolbar"><span className="text-body-small text-muted-foreground">{t("skillsMarket.installedCount", { count: installed.data?.data.length ?? 0 })}</span><Button aria-label={t("skillsMarket.refresh")} disabled={installed.isFetching} onClick={() => void installed.refetch()} size="icon-sm" title={t("skillsMarket.refresh")} type="button" variant="ghost"><RefreshCw className={installed.isFetching ? "animate-spin" : ""} aria-hidden="true" /></Button></div>{installed.isPending ? <div className="skills-market-state" role="status">{t("skillsMarket.loading")}</div> : installed.error !== null ? <div className="skills-market-state" role="alert">{t("skillsMarket.loadError")}</div> : groups.length === 0 ? <div className="skills-market-state">{t("skillsMarket.emptyInstalled")}</div> : <div className="skills-installed-groups">{groups.map((group) => <section className="skills-installed-group" key={group.id}><header><h3>{group.title}</h3><span>{group.skills.length}</span></header><ul>{group.skills.map((skill) => <InstalledRow key={skill.id} onOpen={(item) => open.mutate(item.path)} onToggle={(item) => toggle.mutate(item)} pending={toggle.isPending && toggle.variables?.id === skill.id} skill={skill} />)}</ul></section>)}</div>}</div>;
}
