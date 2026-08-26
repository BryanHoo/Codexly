import { buildTaskAttachmentUrl } from "@codexly/client";
import type { AgentMessageAttachment, AgentSkill, AgentTurn } from "@codexly/protocol";
import { Files, Paperclip, Sparkles } from "lucide-react";
import { useMemo } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { InspectorSection } from "./workbench-inspector-sections.js";
import { MessageImageAttachment } from "./message-image-attachment.js";
import { MessageSourceAttachment } from "./message-source-attachment.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { classifyMessageAttachment } from "../project-file-reference.js";
import { WorkbenchInspectorIncrementalList } from "./workbench-inspector-incremental-list.js";

type InspectorSource = Readonly<{
  detail: string;
  id: string;
  name: string;
  tooltip?: string;
}> &
  Readonly<{ attachment: AgentMessageAttachment; kind: "attachment" } | { kind: "skill" }>;

function formatSkillScope(scope: AgentSkill["scope"]) {
  const labels: Readonly<Record<AgentSkill["scope"], string>> = {
    admin: i18n.t("inspector.sourceRole.admin", { ns: "conversation" }),
    repo: i18n.t("inspector.sourceRole.repo", { ns: "conversation" }),
    system: i18n.t("inspector.sourceRole.system", { ns: "conversation" }),
    user: i18n.t("inspector.sourceRole.user", { ns: "conversation" }),
  };
  return labels[scope];
}

function collectInspectorSources(
  turns: readonly AgentTurn[],
  skills: readonly AgentSkill[],
): InspectorSource[] {
  const sources: InspectorSource[] = [];
  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
  const seenSkills = new Set<string>();
  const seenAttachments = new Set<string>();

  // 同一来源可能在多个 Turn 中重复出现，Inspector 只保留首次使用位置的稳定条目。
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type !== "message" || item.role !== "user") {
        continue;
      }
      for (const skillReference of item.skills ?? []) {
        if (seenSkills.has(skillReference.name)) {
          continue;
        }
        seenSkills.add(skillReference.name);
        const skill = skillsByName.get(skillReference.name);
        sources.push({
          detail: skill === undefined ? "Skill" : `Skill · ${formatSkillScope(skill.scope)}`,
          id: `skill:${skillReference.name}`,
          kind: "skill",
          name: skill?.displayName ?? skillReference.name,
          ...(skill?.description === undefined ? {} : { tooltip: skill.description }),
        });
      }
      for (const attachment of item.attachments ?? []) {
        if (seenAttachments.has(attachment.id)) {
          continue;
        }
        seenAttachments.add(attachment.id);
        sources.push({
          attachment,
          detail: i18n.t("inspector.attachmentDetail", { ns: "conversation" }),
          id: `attachment:${attachment.id}`,
          kind: "attachment",
          name: attachment.name,
        });
      }
    }
  }
  return sources;
}

const interactiveSourceClassName =
  "flex h-auto min-h-10 w-full items-center justify-start gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-control-hover";

function InspectorSourceContent({ source }: Readonly<{ source: InspectorSource }>) {
  const icon =
    source.kind === "skill" ? (
      <Sparkles aria-hidden="true" className="size-3.5 text-brand" />
    ) : (
      <Paperclip aria-hidden="true" className="size-3.5" />
    );
  return (
    <>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-label font-medium text-foreground" title={source.name}>
          {source.name}
        </p>
        <p className="truncate text-caption text-muted-foreground">{source.detail}</p>
      </div>
    </>
  );
}

function InspectorSourceRow({
  attachmentUrl,
  onOpenAttachment,
  source,
}: Readonly<{
  attachmentUrl?: string;
  onOpenAttachment: (attachmentId: string) => void;
  source: InspectorSource;
}>) {
  if (source.kind === "attachment" && attachmentUrl !== undefined) {
    const content = <InspectorSourceContent source={source} />;
    const openKind = classifyMessageAttachment(source.attachment);
    if (openKind === "image") {
      return (
        <MessageImageAttachment
          name={source.name}
          triggerChildren={content}
          triggerClassName={interactiveSourceClassName}
          url={attachmentUrl}
        />
      );
    }
    if (openKind === "source") {
      return (
        <MessageSourceAttachment
          name={source.name}
          triggerChildren={content}
          triggerClassName={interactiveSourceClassName}
          url={attachmentUrl}
        />
      );
    }
    return (
      <Button
        aria-label={i18n.t("timeline.openAttachment", {
          name: source.name,
          ns: "conversation",
        })}
        className={interactiveSourceClassName}
        data-attachment-open="system"
        onClick={() => {
          onOpenAttachment(source.attachment.id);
        }}
        type="button"
        variant="ghost"
      >
        {content}
      </Button>
    );
  }

  if (source.kind === "skill" && source.tooltip !== undefined) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div aria-description={source.tooltip} className={interactiveSourceClassName}>
            <InspectorSourceContent source={source} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">{source.tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className={interactiveSourceClassName}>
      <InspectorSourceContent source={source} />
    </div>
  );
}

export function InspectorSources({
  onOpenAttachment,
  projectId,
  skills,
  taskId,
  turns,
}: Readonly<{
  onOpenAttachment: (attachmentId: string) => void;
  projectId?: string;
  skills: readonly AgentSkill[];
  taskId?: string;
  turns: readonly AgentTurn[];
}>) {
  const sources = useMemo(() => collectInspectorSources(turns, skills), [skills, turns]);
  if (sources.length === 0) return null;

  return (
    <InspectorSection
      icon={<Files className="size-3.5" />}
      title={i18n.t("inspector.source", { ns: "conversation" })}
    >
      <WorkbenchInspectorIncrementalList
        ariaLabel={i18n.t("inspector.contextSources", { ns: "conversation" })}
        getKey={(source) => source.id}
        items={sources}
        renderItem={(source) => (
          <div data-inspector-source-row="">
            <InspectorSourceRow
              {...(source.kind === "attachment" && projectId !== undefined && taskId !== undefined
                ? {
                    attachmentUrl: buildTaskAttachmentUrl(
                      "",
                      projectId,
                      taskId,
                      source.attachment.id,
                    ),
                  }
                : {})}
              onOpenAttachment={onOpenAttachment}
              source={source}
            />
          </div>
        )}
      />
    </InspectorSection>
  );
}
