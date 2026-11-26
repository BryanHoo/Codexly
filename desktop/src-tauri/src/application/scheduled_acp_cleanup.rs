use super::*;
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::json;

pub(super) async fn prepare(directory: &Path, id: &str) -> Result<(), AppError> {
    LocalCatalog::at(directory)?
        .call(
            "acp.schedule.retire",
            json!({"source":"desktop","scheduleId":id}),
        )
        .await?;
    Ok(())
}

/// 持有调度状态锁时读取权威计划；崩溃发生在 JSON 发布前后都能确定清理方向。
pub(super) async fn recover(directory: &Path, tasks: &[ScheduledTask]) -> Result<(), AppError> {
    let store = LocalCatalog::at(directory)?;
    let pending = store
        .call("acp.schedule.retirements", json!({"source":"desktop"}))
        .await?;
    let pending = pending.as_array().ok_or(AppError::ScheduledTaskInvalid)?;
    if pending.is_empty() {
        return Ok(());
    }
    // 只在有待回收项时建立索引，大量计划恢复保持线性开销。
    let active: HashSet<&str> = tasks.iter().map(|task| task.id.as_str()).collect();
    for record in pending {
        let id = record["scheduleId"]
            .as_str()
            .ok_or(AppError::ScheduledTaskInvalid)?;
        store
            .call(
                "acp.schedule.finalize",
                json!({"source":"desktop","scheduleId":id,
            "expectedRevision":record["revision"],"removed":!active.contains(id)}),
            )
            .await?;
    }
    Ok(())
}

pub(super) async fn recover_best_effort(directory: &Path, tasks: &[ScheduledTask]) {
    if let Err(error) = recover(directory, tasks).await {
        // 旧 JSON 已是权威状态，清理失败不把成功删除伪装为失败；意图保留到下次启动恢复。
        log::warn!("ACP scheduled configuration cleanup deferred: {error}");
    }
}
