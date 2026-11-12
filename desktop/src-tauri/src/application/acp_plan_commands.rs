use super::{
    acp_plan_runtime::AcpPlanRuntime, acp_plan_service::AcpPlanService, error::AppError,
    state::AppState,
};
use crate::infrastructure::{app_data, local_catalog::LocalCatalog};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

/// 单一白名单交付命令，仅授权给主窗口；取消等待业务清理完成，不丢弃提交 Future。
#[tauri::command(rename_all = "camelCase")]
pub async fn acp_plan_request(
    app: AppHandle,
    request: Value,
    request_id: Option<String>,
) -> Result<Value, AppError> {
    if request_id
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 128)
    {
        return Err(AppError::ScheduledTaskInvalid);
    }
    let state = app.state::<AppState>();
    let operation_app = app.clone();
    state
        .run_cooperative(request_id.as_deref(), |cancel| async move {
            let app = operation_app;
            let runtime = app.state::<AcpPlanRuntime>();
            let _request = runtime.enter().await?;
            let directory =
                app_data::directory(&app).map_err(|_| AppError::FilesystemRequestFailed)?;
            let catalog = LocalCatalog::at(&directory)?;
            let notify = runtime.inner().clone();
            let events = app.clone();
            let service = AcpPlanService::new(&directory, catalog.clone(), move || {
                notify.wake();
                super::acp_plan_changes::publish(&events);
            });
            let preview_app = app.clone();
            let preview_cancel = cancel.clone();
            super::acp_plan_delivery::deliver(
                &service,
                &catalog,
                request,
                move |project, engine, values| async move {
                    // 只取消尚未提交的临时预览；不嵌套注册同一个 requestId，避免覆盖外层取消令牌。
                    tokio::select! {
                        biased;
                        _ = preview_cancel.cancelled() => Err(AppError::RequestCancelled),
                        result = super::acp_commands::acp_agent_request(
                            preview_app, engine, "settings.preview".into(),
                            json!({"projectId": project, "values": values}), None,
                        ) => result,
                    }
                },
                &cancel,
            )
            .await
        })
        .await
}
