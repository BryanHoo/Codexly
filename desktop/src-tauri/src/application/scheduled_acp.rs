use super::{acp_task_creation::creation_id, error::AppError};
use crate::{
    domain::scheduled_task::{ScheduledTask, ScheduledTaskRun, ScheduledTaskRunStatus},
    infrastructure::local_catalog::LocalCatalog,
};
use serde_json::Value;
use serde_json::json;
use std::future::Future;
use std::path::Path;

#[derive(Debug)]
pub(super) struct LaunchFailure {
    pub message: String,
    pub task_id: Option<String>,
    pub unknown: bool,
}
impl From<AppError> for LaunchFailure {
    fn from(error: AppError) -> Self {
        Self {
            message: error.to_string(),
            task_id: None,
            unknown: false,
        }
    }
}
impl From<String> for LaunchFailure {
    fn from(message: String) -> Self {
        Self {
            message,
            task_id: None,
            unknown: false,
        }
    }
}
fn unknown(id: String) -> LaunchFailure {
    LaunchFailure {
        message: UNKNOWN.to_owned(),
        task_id: Some(id),
        unknown: true,
    }
}

pub(super) async fn try_start<F, Fut>(
    directory: &Path,
    catalog: &LocalCatalog,
    scheduled: &ScheduledTask,
    submit: F,
) -> Result<Option<String>, LaunchFailure>
where
    F: FnOnce(Value) -> Fut,
    Fut: Future<Output = Result<Value, AppError>>,
{
    let run = scheduled
        .runs
        .iter()
        .rev()
        .find(|run| matches!(run.status, ScheduledTaskRunStatus::Running))
        .ok_or(AppError::ScheduledTaskInvalid)?;
    let (key, id) = identity(&scheduled.project_id, &run.id);
    let phase = inspect(catalog, &scheduled.project_id, &run.id)
        .await
        .map_err(|_| unknown(id.clone()))?;
    // 已知结果和未知占用都先于当前配置及目录读取，避免恢复变成第二次 prompt。
    if matches!(phase, Phase::Completed) {
        return Ok(Some(id));
    }
    if matches!(phase, Phase::Unknown) {
        return Err(unknown(id));
    }
    let config = catalog
        .call(
            "acp.schedule.read",
            json!({"source":"desktop","scheduleId":scheduled.id}),
        )
        .await
        .map_err(AppError::from)?;
    if config.is_null() {
        return if matches!(phase, Phase::Absent) {
            Ok(None)
        } else {
            Err(AppError::ScheduledTaskInvalid.into())
        };
    }
    if !scheduled.prompt.skills.is_empty()
        || (scheduled.prompt.text.trim().is_empty() && scheduled.prompt.attachments.is_empty())
    {
        return Err(AppError::ScheduledTaskInvalid.into());
    }
    let engine = config["engine"]
        .as_str()
        .ok_or(AppError::ScheduledTaskInvalid)?;
    let params = json!({"taskId":id,"idempotencyKey":key,"input":scheduled.prompt,"initialConfig":config["values"]});
    let (request, _) = super::acp_prompt_submission::identity(&scheduled.project_id, &params)?;
    // 准备状态证明尚未发送；先记录原指纹，再分配工作区和任务，崩溃可复用稳定身份。
    let prepared = catalog
        .call("acp.submission.prepare", request)
        .await
        .map_err(|_| unknown(id.clone()))?;
    match prepared["status"].as_str() {
        Some("completed") => return Ok(Some(id)),
        Some("available") => {}
        _ => return Err(unknown(id)),
    }
    super::acp_task_creation::create(directory, catalog, &scheduled.project_id, engine, &key)
        .await?;
    let preview: String = (if scheduled.prompt.text.trim().is_empty() {
        &scheduled.name
    } else {
        &scheduled.prompt.text
    })
    .chars()
    .take(1024)
    .collect();
    if let Err(error) = catalog
        .call("task.preview", json!({"id":id,"preview":preview}))
        .await
    {
        return Err(LaunchFailure {
            message: AppError::from(error).to_string(),
            task_id: Some(id),
            unknown: false,
        });
    }
    match submit(params).await {
        Ok(_) => Ok(Some(id)),
        Err(error) => match inspect(catalog, &scheduled.project_id, &run.id).await {
            Ok(Phase::Completed) => Ok(Some(id)),
            Ok(Phase::Available) => Err(LaunchFailure {
                message: error.to_string(),
                task_id: Some(id),
                unknown: false,
            }),
            _ => Err(unknown(id)),
        },
    }
}

/// 新阶段只保存于私有账本，旧文件仍用 failed；附带原任务引用并阻止自动重复执行。
pub(super) fn project_failure(task: &mut ScheduledTask, run_id: &str, failure: &LaunchFailure) {
    if let Some(run) = task.runs.iter_mut().find(|run| run.id == run_id) {
        if let Some(id) = &failure.task_id {
            run.task_id = Some(id.clone());
        }
        if failure.unknown {
            run.error = Some(UNKNOWN.to_owned());
        }
    }
    if failure.unknown {
        task.enabled = false;
        task.next_run_at_unix_ms = None;
    }
}

pub(super) const UNKNOWN: &str =
    "Launch outcome is unknown; inspect the task before creating another schedule";

#[derive(Clone, Copy)]
enum Phase {
    Absent,
    Available,
    Unknown,
    Completed,
}

fn identity(project: &str, run: &str) -> (String, String) {
    let key = format!("scheduled:{run}");
    let id = creation_id(project, &key);
    (key, id)
}

async fn inspect(catalog: &LocalCatalog, project: &str, run: &str) -> Result<Phase, AppError> {
    let (key, id) = identity(project, run);
    let value = catalog
        .call(
            "acp.submission.inspect",
            json!({"projectId":project,"taskId":id,"key":key}),
        )
        .await?;
    match value["status"].as_str() {
        Some("completed") => Ok(Phase::Completed),
        Some("available") => Ok(Phase::Available),
        Some("unknown") => Ok(Phase::Unknown),
        Some("absent") => {
            // 创建过任务却失去账本时不能重新投递；完成项可能已按保留预算淘汰。
            let task = catalog.call("task.read", json!({"id":id})).await?;
            Ok(if task.is_null() {
                Phase::Absent
            } else {
                Phase::Unknown
            })
        }
        _ => Err(AppError::AcpSubmissionConflict),
    }
}

fn candidate(project: &str, run: &ScheduledTaskRun) -> bool {
    matches!(run.status, ScheduledTaskRunStatus::Running)
        || (matches!(run.status, ScheduledTaskRunStatus::Failed)
            && (run.error.as_deref() == Some(UNKNOWN)
                || run.task_id.as_ref().is_some_and(|id| {
                    id.starts_with("acp-") && id == &identity(project, &run.id).1
                })))
}

pub(super) async fn assert_resolved(
    directory: &Path,
    task: &ScheduledTask,
) -> Result<(), AppError> {
    let catalog = LocalCatalog::at(directory)?;
    for run in &task.runs {
        if candidate(&task.project_id, run) {
            let phase = inspect(&catalog, &task.project_id, &run.id).await?;
            if matches!(phase, Phase::Unknown)
                || (matches!(phase, Phase::Absent) && run.error.as_deref() == Some(UNKNOWN))
            {
                return Err(AppError::ScheduledTaskBusy);
            }
        }
    }
    Ok(())
}

pub(super) async fn recover(
    directory: &Path,
    tasks: &mut [ScheduledTask],
    now: i64,
) -> Result<bool, AppError> {
    let catalog = LocalCatalog::at(directory)?;
    let mut changed = false;
    for task in tasks {
        for index in 0..task.runs.len() {
            let run = &task.runs[index];
            if !candidate(&task.project_id, run) {
                continue;
            }
            let phase = inspect(&catalog, &task.project_id, &run.id).await?;
            let unknown = matches!(phase, Phase::Unknown)
                || (matches!(phase, Phase::Absent) && run.error.as_deref() == Some(UNKNOWN));
            if matches!(phase, Phase::Absent) && !unknown {
                continue;
            }
            let completed = matches!(phase, Phase::Completed);
            let id = if matches!(phase, Phase::Absent) {
                run.task_id.clone()
            } else {
                Some(identity(&task.project_id, &run.id).1)
            };
            let error = if completed {
                None
            } else {
                Some(
                    if unknown {
                        UNKNOWN
                    } else {
                        "Scheduled prompt was not submitted"
                    }
                    .to_owned(),
                )
            };
            let status_changed = if completed {
                !matches!(run.status, ScheduledTaskRunStatus::Started)
            } else {
                !matches!(run.status, ScheduledTaskRunStatus::Failed)
            };
            let update = status_changed
                || run.task_id != id
                || run.error != error
                || run.finished_at_unix_ms.is_none()
                || (unknown && (task.enabled || task.next_run_at_unix_ms.is_some()));
            if !update {
                continue;
            }
            let status = if completed {
                ScheduledTaskRunStatus::Started
            } else {
                ScheduledTaskRunStatus::Failed
            };
            let run = &mut task.runs[index];
            run.status = status.clone();
            run.task_id = id;
            run.error = error;
            run.finished_at_unix_ms.get_or_insert(now);
            if index + 1 == task.runs.len() {
                task.last_run_status = Some(status);
            }
            if unknown {
                task.enabled = false;
                task.next_run_at_unix_ms = None;
            }
            task.updated_at_unix_ms = now;
            changed = true;
        }
    }
    Ok(changed)
}
