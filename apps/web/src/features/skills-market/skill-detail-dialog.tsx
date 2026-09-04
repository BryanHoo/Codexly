import type {
  ClawhubSkillDetail,
  ClawhubSkillSummary,
  InstalledSkill,
  Project,
  SkillInstallScope,
} from "@codexly/protocol";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../shared/components/core/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/components/core/select.js";
import type { CodexlySkillMarketClient } from "../projects/project-query-contracts.js";

type SkillDetailDialogProps = Readonly<{
  client: CodexlySkillMarketClient;
  currentProjectId: string | undefined;
  currentRootPath: string | undefined;
  installedSkills: readonly InstalledSkill[];
  installingScope: SkillInstallScope | null;
  onClose: () => void;
  onInstall: (
    skill: ClawhubSkillSummary,
    scope: SkillInstallScope,
    target: Readonly<{ projectId?: string; rootPath?: string }>,
  ) => void;
  projects: readonly Project[];
  skill: ClawhubSkillSummary;
}>;

function openMarketplace(url: string): void {
  try {
    // 仅允许目录返回的 HTTPS 页面离开应用，阻断危险协议。
    const target = new URL(url);
    if (target.protocol === "https:") window.open(target.href, "_blank", "noopener,noreferrer");
  } catch {
    // 非法目录地址保持无副作用。
  }
}

export function SkillDetailDialog({
  client,
  currentProjectId,
  currentRootPath,
  installedSkills,
  installingScope,
  onClose,
  onInstall,
  projects,
  skill,
}: SkillDetailDialogProps) {
  const { t } = useTranslation("workbench");
  const initialProjectId = projects.some((project) => project.id === currentProjectId)
    ? currentProjectId
    : projects[0]?.id;
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const selectedRootPath =
    selectedProject !== undefined &&
    selectedProject.id === currentProjectId &&
    currentRootPath !== undefined &&
    selectedProject.roots.some((root) => root.path === currentRootPath)
      ? currentRootPath
      : selectedProject?.roots[0]?.path;
  const detail = useQuery({
    queryFn: () => client.getClawhubSkill(skill.owner, skill.slug),
    queryKey: ["skills-market", "detail", skill.owner, skill.slug],
    staleTime: 5 * 60_000,
  });
  const data: ClawhubSkillDetail | undefined = detail.data;
  const installedVersion = (scope: SkillInstallScope) =>
    installedSkills.find(
      (installed) =>
        installed.marketplace?.owner === skill.owner &&
        installed.marketplace.slug === skill.slug &&
        (scope === "user"
          ? installed.scope === "user"
          : installed.scope === "repo" && installed.projectId === selectedProjectId),
    )?.marketplace?.installedVersion;
  const actionLabel = (scope: SkillInstallScope) => {
    const version = installedVersion(scope);
    if (version === skill.latestVersion) return t("skillsMarket.current");
    if (version !== undefined) return t("skillsMarket.update");
    return t(scope === "user" ? "skillsMarket.installGlobal" : "skillsMarket.installProject");
  };
  const installing = installingScope !== null;
  const detailUnavailable = data?.scanStatus !== "clean";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="skills-market-detail max-w-3xl gap-0 p-0">
        <DialogHeader className="skills-market-detail__header">
          <div aria-hidden="true" className="skills-market-detail__mark">
            <Sparkles />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-title">{skill.displayName}</DialogTitle>
            <DialogDescription>
              @{skill.owner} / {skill.slug}
            </DialogDescription>
          </div>
          {data === undefined ? null : (
            <span className="skills-market-scan">
              <ShieldCheck aria-hidden="true" />
              {t("skillsMarket.codexCompatible")}
            </span>
          )}
        </DialogHeader>

        <div className="skills-market-detail__facts">
          <span>{t("skillsMarket.version", { version: skill.latestVersion })}</span>
          <span>{t("skillsMarket.downloads", { count: skill.downloads })}</span>
          <span>{t("skillsMarket.stars", { count: skill.stars })}</span>
          {data === undefined ? null : (
            <span>{t("skillsMarket.scan", { status: data.scanStatus })}</span>
          )}
        </div>

        <div className="skills-market-detail__body">
          {detail.isPending ? (
            <div className="skills-market-state" role="status">
              {t("skillsMarket.loadingDetail")}
            </div>
          ) : detail.error !== null ? (
            <div className="skills-market-state" role="alert">
              {t("skillsMarket.loadError")}
            </div>
          ) : (
            <pre className="skills-market-readme">{data?.readme}</pre>
          )}
        </div>

        <DialogFooter className="skills-market-detail__footer">
          <Button
            onClick={() => {
              openMarketplace(skill.canonicalUrl);
            }}
            type="button"
            variant="ghost"
          >
            <ExternalLink aria-hidden="true" />
            {t("skillsMarket.openMarketplace")}
          </Button>
          <div className="flex-1" />
          {selectedProject === undefined || selectedRootPath === undefined ? null : (
            <div className="skills-market-project-target">
              <Select onValueChange={setSelectedProjectId} value={selectedProject.id}>
                <SelectTrigger
                  aria-label={t("skillsMarket.projectTarget")}
                  size="sm"
                  title={selectedProject.name}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end" position="popper">
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={
                  detailUnavailable ||
                  installing ||
                  installedVersion("project") === skill.latestVersion
                }
                onClick={() => {
                  onInstall(skill, "project", {
                    projectId: selectedProject.id,
                    rootPath: selectedRootPath,
                  });
                }}
                type="button"
                variant="outline"
              >
                {installingScope === "project" ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" data-icon="loading" />
                ) : (
                  <Download aria-hidden="true" />
                )}
                {actionLabel("project")}
              </Button>
            </div>
          )}
          <Button
            disabled={
              detailUnavailable || installing || installedVersion("user") === skill.latestVersion
            }
            onClick={() => {
              onInstall(skill, "user", {});
            }}
            type="button"
          >
            {installingScope === "user" ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" data-icon="loading" />
            ) : (
              <Download aria-hidden="true" />
            )}
            {actionLabel("user")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
