use super::*;
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::Value;
use serde_json::json;
use std::future::Future;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConfigInput {
    project_id: String,
    engine: String,
    values: serde_json::Map<String, Value>,
    expected_revision: u64,
    #[serde(default)]
    confirm_migration: bool,
}
fn validate(input: Value) -> Result<ConfigInput, AppError> {
    let input: ConfigInput =
        serde_json::from_value(input).map_err(|_| AppError::ScheduledTaskInvalid)?;
    if input.project_id.is_empty()
        || input.project_id.encode_utf16().count() > 128
        || !matches!(input.engine.as_str(), "codex" | "claude")
        || input.expected_revision > 9_007_199_254_740_991
        || (input.expected_revision == 0 && !input.confirm_migration)
        || input.values.iter().any(|(id, value)| {
            id.is_empty()
                || id.encode_utf16().count() > 256
                || !(value.is_boolean()
                    || value
                        .as_str()
                        .is_some_and(|text| text.encode_utf16().count() <= 16384))
        })
        || serde_json::to_vec(&input.values)
            .map_err(|_| AppError::ScheduledTaskInvalid)?
            .len()
            > 262144
    {
        return Err(AppError::ScheduledTaskInvalid);
    }
    Ok(input)
}
fn complete(view: &Value, input: &ConfigInput) -> Result<bool, AppError> {
    if view["projectId"] != input.project_id {
        return Err(AppError::ScheduledTaskConfigConflict);
    }
    let config = &view["config"];
    if !config.is_null()
        && config["engine"] == input.engine
        && config["values"] == Value::Object(input.values.clone())
    {
        return Ok(true);
    }
    if config["revision"].as_u64().unwrap_or(0) != input.expected_revision {
        return Err(AppError::ScheduledTaskConfigConflict);
    }
    if view["canEdit"] != true {
        return Err(AppError::ScheduledTaskBusy);
    }
    Ok(false)
}
async fn view(directory: &Path, state: &RuntimeState, id: &str) -> Result<Value, AppError> {
    let task = state
        .tasks
        .iter()
        .find(|task| task.id == id)
        .ok_or(AppError::ScheduledTaskNotFound)?;
    let can_edit = if state.running.contains(id)
        || task
            .runs
            .iter()
            .any(|run| matches!(run.status, ScheduledTaskRunStatus::Running))
    {
        false
    } else {
        match super::super::scheduled_acp::assert_resolved(directory, task).await {
            Ok(()) => true,
            Err(AppError::ScheduledTaskBusy) => false,
            Err(error) => return Err(error),
        }
    };
    let record = LocalCatalog::at(directory)?
        .call(
            "acp.schedule.read",
            json!({"source":"desktop","scheduleId":id}),
        )
        .await?;
    Ok(
        json!({"projectId":task.project_id,"canEdit":can_edit,"config":if record.is_null(){Value::Null}else{json!({"engine":record["engine"],"values":record["values"],"revision":record["revision"]})}}),
    )
}

impl ScheduledTaskRuntime {
    pub async fn read_acp_scheduled_config(
        &self,
        directory: &Path,
        id: &str,
    ) -> Result<Value, AppError> {
        self.ensure_loaded(directory).await?;
        let state = self.inner.lock().await;
        view(directory, &state, id).await
    }
    pub async fn save_acp_scheduled_config<F, Fut>(
        &self,
        directory: &Path,
        id: &str,
        input: Value,
        preview: F,
    ) -> Result<Value, AppError>
    where
        F: FnOnce(String, String, Value) -> Fut,
        Fut: Future<Output = Result<Value, AppError>>,
    {
        let input = validate(input)?;
        let initial = self.read_acp_scheduled_config(directory, id).await?;
        // 响应丢失后先确认相同落盘值；不重复预览或递增修订，也不改旧计划文件。
        if complete(&initial, &input)? {
            return Ok(initial);
        }
        let checked = preview(
            input.project_id.clone(),
            input.engine.clone(),
            Value::Object(input.values.clone()),
        )
        .await?;
        let options = checked["configOptions"]
            .as_array()
            .ok_or(AppError::ScheduledTaskInvalid)?;
        if !input.values.iter().all(|(id, value)| {
            options.iter().any(|option| {
                option["id"].as_str() == Some(id.as_str()) && option["currentValue"] == *value
            })
        }) {
            return Err(AppError::ScheduledTaskInvalid);
        }
        // 智能体 I/O 已结束，再持有计划状态锁，重新校验归属、占用和修订后落盘。
        let state = self.inner.lock().await;
        let current = view(directory, &state, id).await?;
        if complete(&current, &input)? {
            return Ok(current);
        }
        let record=LocalCatalog::at(directory)?.call("acp.schedule.set",json!({"source":"desktop","scheduleId":id,"engine":input.engine,"values":input.values,"expectedRevision":input.expected_revision})).await?;
        if record.is_null() {
            return Err(AppError::ScheduledTaskConfigConflict);
        }
        Ok(
            json!({"projectId":input.project_id,"canEdit":true,"config":{"engine":record["engine"],"values":record["values"],"revision":record["revision"]}}),
        )
    }
}
