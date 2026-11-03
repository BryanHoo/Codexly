use super::{AppError, AppState, LocalCatalog};
use serde_json::{Value, json};
use std::time::Duration;

pub(super) async fn restore(
    state: &AppState,
    catalog: &LocalCatalog,
    task: &Value,
) -> Result<Value, AppError> {
    if task["provider"] == "codex" {
        mutate_codex(state, catalog, task, "thread/unarchive").await
    } else {
        // 当前 Claude SDK 无归档能力，恢复也只修改应用记录。
        Ok(catalog
            .call("task.patch", json!({"id":task["id"],"archived":false}))
            .await?)
    }
}

/// 两端生命周期共用连接适配边界；空任务保持离线可管理，不要求启动 Codex。
pub(super) async fn mutate_codex(
    state: &AppState,
    catalog: &LocalCatalog,
    task: &Value,
    method: &str,
) -> Result<Value, AppError> {
    if !task["sessionId"].is_null() {
        let connection = state.codex_connection().await?;
        // 与回合启动、恢复和退订使用同一任务锁，不能在检查后插入新的执行请求。
        let id = task["id"]
            .as_str()
            .ok_or(AppError::FilesystemRequestFailed)?;
        let _subscription = connection.lock_task_subscription(id).await?;
        let response: Value = connection
            .request(method, &json!({"threadId":id}), Duration::from_secs(30))
            .await?;
        if method != "thread/unarchive" {
            return Ok(response);
        }
        return Ok(catalog.call("task.read", json!({"id":id})).await?);
    }
    // 无原生绑定时直接提交本地状态，不创建新的引擎历史。
    Ok(if method == "thread/delete" {
        catalog
            .call("task.remove", json!({"id":task["id"]}))
            .await?
    } else {
        catalog
            .call(
                "task.patch",
                json!({"id":task["id"],"archived":method=="thread/archive"}),
            )
            .await?
    })
}
