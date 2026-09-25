import { buildNativeAssetUrl } from "@/platform/native-asset-url.js";
import {
  TEMPORARY_TASK_SCOPE_ID,
  type AgentMessageAttachment,
  type AgentPromptInput,
  type AgentSkill,
  type AgentTaskSettings,
  type AgentTurnOptions,
  type Project,
  type ScheduledTask,
  type ScheduledTaskInput,
} from "@/protocol/index.js";
import { CalendarClock, ExternalLink, History, Play, Save, SlidersHorizontal } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { Input } from "../../shared/components/core/input.js";
import type { ComposerDraft } from "../workbench/composer-draft-context.js";
import { createPromptSkillContentFromSubmission } from "../workbench/components/prompt-skill-content.js";
import {
  WorkbenchComposer,
  type WorkbenchComposerHandle,
  type WorkbenchComposerProps,
} from "../workbench/components/workbench-composer.js";
import {
  defaultScheduleDraft,
  draftToSchedule,
  formatScheduledTime,
  scheduleToDraft,
  scheduleDraftError,
  scheduledTaskEnded,
  type ScheduleDraft,
} from "./scheduled-task-schedule.js";
import { ScheduledTaskScheduleFields } from "./scheduled-task-schedule-fields.js";
import { ScheduledTaskPreview } from "./scheduled-task-preview.js";
import { useSchedulePreview, type PreviewSchedule } from "./use-schedule-preview.js";

type EditorProps = Readonly<{
  composerProps: WorkbenchComposerProps;
  onOpenRun: (projectId: string, taskId: string) => void;
  openingRun?: boolean;
  onProjectChange: (projectId: string) => void;
  onPreview: PreviewSchedule;
  onRunNow: (id: string) => Promise<void>;
  onSave: (taskId: string | undefined, input: ScheduledTaskInput) => Promise<void>;
  projectId: string;
  projects: readonly Project[];
  skills: readonly AgentSkill[];
  task?: ScheduledTask;
}>;

function hostAttachments(attachments: readonly AgentMessageAttachment[]): ComposerDraft["attachments"] {
  return attachments.map((attachment) => ({
    attachment,
    ...attachment,
    previewUrl: attachment.kind === "image" ? buildNativeAssetUrl(attachment.id) : "",
    source: "host" as const,
  }));
}

function promptDraft(task: ScheduledTask | undefined, skills: readonly AgentSkill[]): ComposerDraft {
  if (task === undefined) return { attachments: [], content: [] };
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const selectedSkills = task.prompt.skills.flatMap((reference) => {
    const skill = byId.get(reference.id);
    return skill === undefined ? [] : [skill];
  });
  return {
    attachments: hostAttachments(task.prompt.attachments),
    content: createPromptSkillContentFromSubmission(task.prompt.text, selectedSkills),
  };
}

export function ScheduledTaskEditor(props: EditorProps) {
  const { i18n, t } = useTranslation("workbench");
  const [timezone] = useState(() => props.task?.schedule.type === "rrule"
    ? props.task.schedule.timezone
    : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const composerRef = useRef<WorkbenchComposerHandle>(null);
  const [name, setName] = useState(props.task?.name ?? "");
  const [schedule, setSchedule] = useState<ScheduleDraft>(
    () => props.task === undefined ? defaultScheduleDraft() : scheduleToDraft(props.task.schedule),
  );
  const [settings, setSettings] = useState<AgentTaskSettings>(
    props.task?.turnOptions ?? props.composerProps.settings,
  );
  const [saving, setSaving] = useState(false);
  const [hasPromptInput, setHasPromptInput] = useState(
    props.task !== undefined &&
      (props.task.prompt.text.trim() !== "" ||
        props.task.prompt.attachments.length > 0 ||
        props.task.prompt.skills.length > 0),
  );
  const initialDraft = useMemo(
    () => promptDraft(props.task, props.skills),
    [props.skills, props.task],
  );
  const selectedProjectName =
    props.projectId === TEMPORARY_TASK_SCOPE_ID
      ? t("shell.temporaryTask")
      : (props.projects.find((project) => project.id === props.projectId)?.name ?? props.projectId);
  const resolvedSchedule = useMemo(() => draftToSchedule(schedule, timezone), [schedule, timezone]);
  const preview = useSchedulePreview(resolvedSchedule, props.onPreview);
  const scheduleError = scheduleDraftError(schedule) ?? (resolvedSchedule === undefined ? schedule.preset === "once" ? "oncePast" : "invalidWallTime" : undefined);
  const formComplete = name.trim() !== "" && resolvedSchedule !== undefined && hasPromptInput && !preview.pending && !preview.failed;

  const capture = async (
    prompt: AgentPromptInput,
    turnOptions: AgentTurnOptions,
    _attachments: readonly AgentMessageAttachment[],
  ) => {
    if (name.trim() === "") {
      throw new Error(t("scheduledTasks.name"));
    }
    const capturedSchedule = draftToSchedule(schedule, timezone);
    if (capturedSchedule === undefined || preview.pending || preview.failed) throw new Error(t("scheduledTasks.scheduleInvalid"));
    await props.onSave(props.task?.id, {
      enabled: props.task?.enabled ?? true,
      name: name.trim(),
      projectId: props.projectId,
      projectName: selectedProjectName,
      prompt,
      schedule: capturedSchedule,
      turnOptions,
    });
  };

  return (
    <section className="scheduled-task-editor">
      <div className="scheduled-task-editor__toolbar">
        <span className="scheduled-task-status" data-enabled={props.task?.enabled ?? true}>
          <span />{t(props.task === undefined ? "scheduledTasks.create" : scheduledTaskEnded(props.task) ? "scheduledTasks.ended" : props.task.enabled ? "scheduledTasks.enabled" : "scheduledTasks.disabled")}
        </span>
        <div className="scheduled-task-editor__actions">
        {props.task === undefined ? <span /> : (
          <Button
            aria-label={t("scheduledTasks.runNow")}
            disabled={props.task.lastRunStatus === "running"}
            onClick={() => void props.onRunNow(props.task!.id)}
            size="sm"
            variant="outline"
          >
            <Play aria-hidden="true" />{t("scheduledTasks.runNow")}
          </Button>
        )}
        <Button
          aria-label={t("scheduledTasks.save")}
          className="disabled:bg-control-active disabled:text-muted-foreground disabled:opacity-100"
          disabled={saving || !formComplete}
          onClick={() => void composerRef.current?.submitCurrent()}
          size="sm"
        >
          <Save aria-hidden="true" />{t("scheduledTasks.save")}
        </Button>
        </div>
      </div>

      <div className="scheduled-task-editor__body">
      <label className="scheduled-task-title">
        <span className="sr-only">{t("scheduledTasks.name")}</span>
        <Input maxLength={120} onChange={(event) => setName(event.currentTarget.value)} placeholder={t("scheduledTasks.namePlaceholder")} value={name} />
      </label>
      <div className="scheduled-task-prompt">
        <h3>{t("scheduledTasks.prompt")}</h3>
        <WorkbenchComposer
          {...props.composerProps}
          captureSubmitVisible={false}
          composerRef={composerRef}
          composerDraftId={`scheduled:${props.task?.id ?? "new"}`}
          footerVisible={false}
          initialDraft={initialDraft}
          onCaptureSubmission={capture}
          onFastModeChange={props.composerProps.onFastModeChange}
          onInputStateChange={setHasPromptInput}
          onSettingsChange={(next, field, fastMode) => {
            setSettings(next);
            return props.composerProps.onSettingsChange(next, field, fastMode);
          }}
          onSubmissionStateChange={setSaving}
          settings={settings}
        />
      </div>

      <section className="scheduled-task-section">
        <h3><SlidersHorizontal aria-hidden="true" />{t("scheduledTasks.details")}</h3>
        <div className="scheduled-task-fields">
          <label><span>{t("scheduledTasks.project")}</span><select onChange={(event) => props.onProjectChange(event.currentTarget.value)} value={props.projectId}><option value={TEMPORARY_TASK_SCOPE_ID}>{t("shell.temporaryTask")}</option>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <div className="scheduled-task-info"><span>{t("scheduledTasks.runIn")}</span><span>{t("scheduledTasks.newChat")}</span></div>
        </div>
      </section>
      <section className="scheduled-task-section">
        <h3><CalendarClock aria-hidden="true" />{t("scheduledTasks.frequency")}</h3>
        <div className="scheduled-task-fields"><ScheduledTaskScheduleFields onChange={setSchedule} schedule={schedule} /></div>
        <ScheduledTaskPreview schedule={schedule} timezone={timezone} {...preview} error={scheduleError} />
      </section>
      {props.task === undefined ? null : (
        <>
          <div className="scheduled-task-runs">
            <h3><History aria-hidden="true" />{t("scheduledTasks.lastRun")}<span>{props.task.runs.length}</span></h3>
            {props.task.runs.length === 0 ? <p>{t("scheduledTasks.noRuns")}</p> : props.task.runs.toReversed().map((run) => (
              <div className="scheduled-task-run" data-status={run.status} key={run.id}>
                <span>{t(`scheduledTasks.${run.status}`)}</span>
                <time>{formatScheduledTime(run.startedAtUnixMs, i18n.resolvedLanguage)}</time>
                {run.taskId === null ? <span className="scheduled-task-run__error">{run.error}</span> : <Button aria-label={run.taskId} disabled={props.openingRun} onClick={() => props.onOpenRun(props.task!.projectId, run.taskId!)} size="icon-sm" variant="ghost"><ExternalLink aria-hidden="true" /></Button>}
              </div>
            ))}
          </div>
        </>
      )}
      </div>
    </section>
  );
}
