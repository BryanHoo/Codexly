use super::error::AppError;
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
use std::future::Future;
use tauri::Emitter;
pub(super) fn publish(app: &tauri::AppHandle) {
    // 原生事件只使视图失效；发送失败不能使已提交操作返回失败。
    let _ = app.emit("acp-plan://changed", json!({"type":"acp-plans.changed"}));
}
fn same(a: &Value, b: &Value) -> bool {
    ["status", "taskId", "error"]
        .iter()
        .all(|key| a.get(key) == b.get(key))
}
/// 只观察正在执行的运行，不新增轮询；未变化的未知恢复不反复刷新前端。
pub(super) async fn observe<F, N>(
    catalog: &LocalCatalog,
    id: &str,
    run: &str,
    execute: F,
    mut notify: N,
) -> Result<Value, AppError>
where
    F: Future<Output = Result<Value, AppError>>,
    N: FnMut(),
{
    let key = json!({"source":"desktop","scheduleId":id,"runId":run});
    let before = catalog
        .call("acp.plan.summary", key.clone())
        .await
        .unwrap_or(Value::Null);
    if before["status"] == "claimed" {
        notify();
    }
    let result = execute.await;
    match &result {
        Ok(after) => {
            if !same(&before, after) {
                notify();
            }
        }
        Err(_) => {
            // 即使提交后抛错，也以实际落盘状态校准；通知不能覆盖原始执行错误。
            let after = catalog
                .call("acp.plan.summary", key)
                .await
                .unwrap_or_else(|_| before.clone());
            if !same(&before, &after) {
                notify();
            }
        }
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn plan_changes_should_ignore_unchanged_unknown_and_keep_original_error() {
        let root = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(root.path()).unwrap();
        let mut definition: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
        ))
        .unwrap();
        definition["enabled"] = json!(true);
        catalog.call("acp.plan.set",json!({"source":"desktop","scheduleId":"plan","definition":definition,"expectedRevision":0})).await.unwrap();
        catalog.call("acp.plan.arm",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap();
        catalog.call("acp.plan.claimRef",json!({"source":"desktop","scheduleId":"plan","expectedRevision":1,"expectedStateRevision":1,"now":10,"nextRunAt":null,"runId":"run"})).await.unwrap();
        let mut notices = 0;
        let execute = async {
            Ok(catalog.call("acp.plan.finish",json!({"source":"desktop","scheduleId":"plan","runId":"run","expectedStatus":"claimed","status":"unknown","taskId":null,"error":"pending"})).await?)
        };
        let unknown = observe(&catalog, "plan", "run", execute, || notices += 1)
            .await
            .unwrap();
        assert_eq!(notices, 2);
        observe(&catalog, "plan", "run", async { Ok(unknown) }, || {
            notices += 1
        })
        .await
        .unwrap();
        assert_eq!(notices, 2);
        let result = observe(
            &catalog,
            "plan",
            "run",
            async { Err(AppError::AcpSubmissionUnknown) },
            || notices += 1,
        )
        .await;
        assert!(matches!(result, Err(AppError::AcpSubmissionUnknown)));
        assert_eq!(notices, 2);
    }
}
