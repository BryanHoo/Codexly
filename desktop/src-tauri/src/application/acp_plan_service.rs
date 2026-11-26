use super::error::AppError;
use crate::infrastructure::local_catalog::{LocalCatalog, valid_plan_definition};
use serde_json::{Value, json};
use std::{
    future::Future,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveInput {
    definition: Value,
    resources: Vec<String>,
    expected_revision: u64,
    expected_state_revision: u64,
}
fn validate(input: Value) -> Result<SaveInput, AppError> {
    if serde_json::to_vec(&input)
        .map_err(|_| AppError::ScheduledTaskInvalid)?
        .len()
        > 1048576
    {
        return Err(AppError::ScheduledTaskInvalid);
    }
    let input: SaveInput =
        serde_json::from_value(input).map_err(|_| AppError::ScheduledTaskInvalid)?;
    let mut tokens = std::collections::HashSet::new();
    if !valid_plan_definition(&input.definition)
        || input.definition["name"]
            .as_str()
            .is_none_or(|s| s.trim().is_empty())
        || input.expected_revision > 9_007_199_254_740_991
        || input.expected_state_revision > 9_007_199_254_740_991
        || input.resources.len() > 1500
        || input.resources.iter().any(|token| {
            token.is_empty() || token.encode_utf16().count() > 128 || !tokens.insert(token)
        })
    {
        return Err(AppError::ScheduledTaskInvalid);
    }
    Ok(input)
}
fn key(id: &str) -> Result<Value, AppError> {
    if id.is_empty() || id.encode_utf16().count() > 256 {
        return Err(AppError::ScheduledTaskInvalid);
    }
    Ok(json!({"source":"desktop","scheduleId":id}))
}
fn check_cancelled(cancel: &CancellationToken) -> Result<(), AppError> {
    if cancel.is_cancelled() {
        Err(AppError::RequestCancelled)
    } else {
        Ok(())
    }
}

pub(super) struct AcpPlanService {
    directory: PathBuf,
    catalog: LocalCatalog,
    wake: Arc<dyn Fn() + Send + Sync>,
}
impl AcpPlanService {
    pub fn new(
        directory: &Path,
        catalog: LocalCatalog,
        wake: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        Self {
            directory: directory.to_owned(),
            catalog,
            wake: Arc::new(wake),
        }
    }
    pub async fn read(&self, id: &str) -> Result<Value, AppError> {
        Ok(self.catalog.call("acp.plan.view", key(id)?).await?)
    }
    async fn project_root(&self, project: &str) -> Result<PathBuf, AppError> {
        // 目录只来自授权目录或应用临时工作区设置，不能接受计划中的路径覆盖。
        let path = if project == "temporary" {
            let root =
                crate::infrastructure::temporary_workspace_settings::read_root(&self.directory)
                    .await
                    .map_err(|_| AppError::FilesystemRequestFailed)?;
            tokio::fs::create_dir_all(&root)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            root
        } else {
            let entry = self
                .catalog
                .call("project.read", json!({"id":project}))
                .await?;
            PathBuf::from(
                entry["path"]
                    .as_str()
                    .ok_or(AppError::FilesystemRequestFailed)?,
            )
        };
        let path = tokio::fs::canonicalize(path)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?;
        if !tokio::fs::metadata(&path)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?
            .is_dir()
        {
            return Err(AppError::FilesystemRequestFailed);
        }
        Ok(path)
    }
    /// 预览及日历解析不持有数据库锁；最终检查双修订，不能覆盖正在被领取的计划。
    pub async fn save<F, Fut, C>(
        &self,
        id: &str,
        input: Value,
        preview: F,
        now: C,
        cancel: &CancellationToken,
    ) -> Result<Value, AppError>
    where
        F: FnOnce(String, String, Value) -> Fut,
        Fut: Future<Output = Result<Value, AppError>>,
        C: Fn() -> i64,
    {
        key(id)?;
        let input = validate(input)?;
        check_cancelled(cancel)?;
        let before = self.read(id).await?;
        let definition = &input.definition;
        if before["revision"].as_u64().unwrap_or(0) != input.expected_revision
            || before["state"]["revision"].as_u64().unwrap_or(0) != input.expected_state_revision
            || (!before.is_null() && before["definition"]["projectId"] != definition["projectId"])
        {
            return Err(AppError::ScheduledTaskConfigConflict);
        }
        if before["canEdit"] == false {
            return Err(AppError::ScheduledTaskBusy);
        }
        let project = definition["projectId"]
            .as_str()
            .ok_or(AppError::ScheduledTaskInvalid)?;
        let root = self.project_root(project).await?;
        let enabled = definition["enabled"] == true;
        if enabled {
            if (definition["prompt"]["text"]
                .as_str()
                .is_none_or(|s| s.trim().is_empty())
                && definition["prompt"]["attachments"]
                    .as_array()
                    .is_none_or(Vec::is_empty))
                || definition["prompt"]["skills"]
                    .as_array()
                    .is_none_or(|a| !a.is_empty())
            {
                return Err(AppError::ScheduledTaskInvalid);
            }
            if before["definition"]["enabled"] != true
                || before["definition"]["engine"] != definition["engine"]
                || before["definition"]["values"] != definition["values"]
            {
                check_cancelled(cancel)?;
                let checked = preview(
                    project.to_owned(),
                    definition["engine"]
                        .as_str()
                        .ok_or(AppError::ScheduledTaskInvalid)?
                        .to_owned(),
                    definition["values"].clone(),
                )
                .await?;
                let options = checked["configOptions"]
                    .as_array()
                    .ok_or(AppError::ScheduledTaskInvalid)?;
                if !definition["values"]
                    .as_object()
                    .ok_or(AppError::ScheduledTaskInvalid)?
                    .iter()
                    .all(|(id, value)| {
                        options.iter().any(|option| {
                            option["id"].as_str() == Some(id.as_str())
                                && option["currentValue"] == *value
                        })
                    })
                {
                    return Err(AppError::ScheduledTaskInvalid);
                }
            }
        }
        let next = if !enabled {
            Value::Null
        } else if before["definition"]["enabled"] == true
            && !before["state"].is_null()
            && before["state"]["definitionRevision"] == before["revision"]
            && before["definition"]["schedule"] == definition["schedule"]
        {
            before["state"]["nextRunAt"].clone()
        } else {
            let schedule: crate::domain::scheduled_task::ScheduledTaskSchedule =
                serde_json::from_value(definition["schedule"].clone())
                    .map_err(|_| AppError::ScheduledTaskInvalid)?;
            let time = now();
            let dates=tauri::async_runtime::spawn_blocking(move|| {
                    if matches!(&schedule,crate::domain::scheduled_task::ScheduledTaskSchedule::Once{at_unix_ms} if *at_unix_ms<=time){return Err(AppError::ScheduledTaskInvalid);}
                    crate::infrastructure::scheduled_tasks::resolve_schedule_runs(&schedule,time,1).map_err(|_|AppError::ScheduledTaskInvalid)
                }).await.map_err(|_|AppError::ScheduledTaskInvalid)??;
            json!(dates.first())
        };
        if self.project_root(project).await? != root {
            return Err(AppError::ScheduledTaskConfigConflict);
        }
        check_cancelled(cancel)?;
        let saved=self.catalog.call("acp.plan.commit",json!({"source":"desktop","scheduleId":id,"definition":definition,"resources":input.resources,"expectedRevision":input.expected_revision,"expectedStateRevision":input.expected_state_revision,"nextRunAt":next})).await?;
        if saved.is_null() {
            return Err(AppError::ScheduledTaskConfigConflict);
        }
        // 唤醒端口仅发送 Notify 提示；持久提交不依赖调度循环是否已经启动。
        (self.wake)();
        Ok(saved)
    }
    pub async fn delete(&self, id: &str, revision: u64) -> Result<bool, AppError> {
        let mut request = key(id)?;
        request["expectedRevision"] = json!(revision);
        let deleted = self.catalog.call("acp.plan.delete", request).await? == true;
        if deleted {
            (self.wake)();
        }
        Ok(deleted)
    }
    pub async fn stage(
        &self,
        id: &str,
        project: &str,
        attachment: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, AppError> {
        let before = self.read(id).await?;
        if !before.is_null() && before["definition"]["projectId"] != project {
            return Err(AppError::ScheduledTaskConfigConflict);
        }
        if before["canEdit"] == false {
            return Err(AppError::ScheduledTaskBusy);
        }
        self.project_root(project).await?;
        super::acp_plan_resources::stage(
            &self.directory,
            &self.catalog,
            id,
            project,
            attachment,
            cancel,
        )
        .await
    }
}
#[cfg(test)]
#[path = "acp_plan_service_tests.rs"]
mod tests;
