import { buildProjectAttachmentUrl } from "@codexly/client";
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
} from "@codexly/protocol";
import { ExternalLink, Play, Save, Trash2 } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Input } from "../../../shared/components/core/input.js";
import type { ComposerDraft } from "../../workbench/composer-draft-context.js";
import { createPromptSkillContentFromSubmission } from "../../workbench/components/prompt-skill-content.js";
import {
  WorkbenchComposer,
  type WorkbenchComposerHandle,
  type WorkbenchComposerProps,
} from "../../workbench/components/workbench-composer.js";
import {
  defaultScheduleDraft,
  draftToSchedule,
  formatScheduledTime,
  scheduleToDraft,
  type ScheduleDraft,
  type SchedulePreset,
} from "../scheduled-task-schedule.js";

const ScheduledTaskDateTimePicker = lazy(() =>
  import("./scheduled-task-date-time-picker.js").then((module) => ({
    default: module.ScheduledTaskDateTimePicker,
  })),
);

type EditorProps = Readonly<{
  composerProps: WorkbenchComposerProps;
  onDelete: (id: string) => Promise<void>;
  onOpenRun: (projectId: string, taskId: string) => void;
  onProjectChange: (projectId: string) => void;
  onRunNow: (id: string) => Promise<void>;
  onSave: (taskId: string | undefined, input: ScheduledTaskInput) => Promise<void>;
  projectId: string;
  projects: readonly Project[];
  skills: readonly AgentSkill[];
  task?: ScheduledTask;
}>;

function hostAttachments(task: ScheduledTask | undefined): ComposerDraft["attachments"] {
  if (task === undefined) return [];
  return task.messageAttachments.map((attachment) => ({
    attachment,
    ...attachment,
    previewUrl:
      attachment.kind === "image"
        ? buildProjectAttachmentUrl("", task.projectId, attachment.id)
        : "",
    source: "host" as const,
  }));
}

function promptDraft(
  task: ScheduledTask | undefined,
  skills: readonly AgentSkill[],
): ComposerDraft {
  if (task === undefined) return { attachments: [], content: [] };
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const selectedSkills = task.prompt.skills.flatMap((reference) => {
    const skill = skillsById.get(reference.id);
    return skill === undefined ? [] : [skill];
  });
  return {
    attachments: hostAttachments(task),
    content: createPromptSkillContentFromSubmission(task.prompt.text, selectedSkills),
  };
}

export function ScheduledTaskEditor(props: EditorProps) {
  const { i18n, t } = useTranslation("workbench");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const composerRef = useRef<WorkbenchComposerHandle>(null);
  const [name, setName] = useState(props.task?.name ?? "");
  const [schedule, setSchedule] = useState<ScheduleDraft>(
    props.task === undefined ? defaultScheduleDraft() : scheduleToDraft(props.task.schedule),
  );
  const [settings, setSettings] = useState<AgentTaskSettings>(
    props.task?.turnOptions ?? props.composerProps.settings,
  );
  const [deleteArmed, setDeleteArmed] = useState(false);
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
  const resolvedSchedule = draftToSchedule(schedule, timezone);
  const formComplete = name.trim() !== "" && resolvedSchedule !== undefined && hasPromptInput;
  const task = props.task;

  const capture = async (
    prompt: AgentPromptInput,
    turnOptions: AgentTurnOptions,
    messageAttachments: readonly AgentMessageAttachment[],
  ) => {
    if (resolvedSchedule === undefined) throw new Error(t("scheduledTasks.scheduleInvalid"));
    await props.onSave(props.task?.id, {
      enabled: props.task?.enabled ?? true,
      messageAttachments: [...messageAttachments],
      name: name.trim(),
      projectId: props.projectId,
      projectName: selectedProjectName,
      prompt,
      schedule: resolvedSchedule,
      turnOptions,
    });
  };

  return (
    <section className="scheduled-task-editor">
      <div className="scheduled-task-toolbar">
        {task === undefined ? (
          <span />
        ) : (
          <Button
            aria-label={t("scheduledTasks.runNow")}
            disabled={task.lastRunStatus === "running"}
            onClick={() => {
              void props.onRunNow(task.id);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Play aria-hidden="true" />
            {t("scheduledTasks.runNow")}
          </Button>
        )}
        <Button
          aria-label={t("scheduledTasks.save")}
          disabled={saving || !formComplete}
          onClick={() => void composerRef.current?.submitCurrent()}
          size="sm"
          type="button"
        >
          <Save aria-hidden="true" />
          {t("scheduledTasks.save")}
        </Button>
      </div>
      <div className="scheduled-task-fields">
        <label>
          <span>{t("scheduledTasks.name")}</span>
          <Input
            maxLength={120}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
            placeholder={t("scheduledTasks.namePlaceholder")}
            value={name}
          />
        </label>
        <label>
          <span>{t("scheduledTasks.project")}</span>
          <select
            onChange={(event) => {
              props.onProjectChange(event.currentTarget.value);
            }}
            value={props.projectId}
          >
            <option value={TEMPORARY_TASK_SCOPE_ID}>{t("shell.temporaryTask")}</option>
            {props.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("scheduledTasks.time")}</span>
          <Suspense
            fallback={
              <Input aria-label={t("scheduledTasks.time")} aria-busy="true" disabled value="" />
            }
          >
            <ScheduledTaskDateTimePicker
              minimum={defaultScheduleDraft(Date.now() - 59 * 60 * 1_000).dateTime}
              onChange={(dateTime) => {
                setSchedule({ ...schedule, dateTime });
              }}
              value={schedule.dateTime}
            />
          </Suspense>
        </label>
        <label>
          <span>{t("scheduledTasks.repeat")}</span>
          <select
            onChange={(event) => {
              setSchedule({ ...schedule, preset: event.currentTarget.value as SchedulePreset });
            }}
            value={schedule.preset}
          >
            {(["once", "daily", "weekdays", "weekly", "monthly", "custom"] as const).map(
              (preset) => (
                <option key={preset} value={preset}>
                  {t(`scheduledTasks.${preset}`)}
                </option>
              ),
            )}
          </select>
        </label>
        {schedule.preset === "custom" ? (
          <label className="scheduled-task-wide">
            <span>{t("scheduledTasks.rrule")}</span>
            <Input
              maxLength={2_048}
              onChange={(event) => {
                setSchedule({ ...schedule, rrule: event.currentTarget.value });
              }}
              placeholder={t("scheduledTasks.rrulePlaceholder")}
              spellCheck={false}
              value={schedule.rrule}
            />
          </label>
        ) : null}
      </div>
      <div className="scheduled-task-prompt">
        <h3>{t("scheduledTasks.prompt")}</h3>
        <WorkbenchComposer
          {...props.composerProps}
          captureSubmitVisible={false}
          composerDraftId={`scheduled:${props.task?.id ?? "new"}`}
          composerRef={composerRef}
          footerVisible={false}
          initialDraft={initialDraft}
          onCaptureSubmission={capture}
          onInputStateChange={setHasPromptInput}
          onSettingsChange={(next, field, fastMode) => {
            setSettings(next);
            return props.composerProps.onSettingsChange(next, field, fastMode);
          }}
          onSubmissionStateChange={setSaving}
          settings={settings}
        />
      </div>
      {task === undefined ? null : (
        <>
          <div className="scheduled-task-runs">
            <h3>{t("scheduledTasks.lastRun")}</h3>
            {task.runs.length === 0 ? (
              <p>{t("scheduledTasks.noRuns")}</p>
            ) : (
              task.runs.toReversed().map((run) => (
                <div className="scheduled-task-run" data-status={run.status} key={run.id}>
                  <span>{t(`scheduledTasks.${run.status}`)}</span>
                  <time>{formatScheduledTime(run.startedAtUnixMs, i18n.resolvedLanguage)}</time>
                  {run.taskId === null ? (
                    <span className="truncate text-danger">{run.error}</span>
                  ) : (
                    <Button
                      aria-label={run.taskId}
                      onClick={() => {
                        if (run.taskId !== null) props.onOpenRun(task.projectId, run.taskId);
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <ExternalLink aria-hidden="true" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="scheduled-task-danger">
            {deleteArmed ? (
              <Button
                onClick={() => {
                  setDeleteArmed(false);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("actions.cancel")}
              </Button>
            ) : null}
            <Button
              aria-label={
                deleteArmed ? t("scheduledTasks.deleteConfirm") : t("scheduledTasks.delete")
              }
              onClick={() => {
                if (deleteArmed) void props.onDelete(task.id);
                else setDeleteArmed(true);
              }}
              size="sm"
              type="button"
              variant="destructive"
            >
              <Trash2 aria-hidden="true" />
              {deleteArmed ? t("scheduledTasks.deleteConfirm") : t("scheduledTasks.delete")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
