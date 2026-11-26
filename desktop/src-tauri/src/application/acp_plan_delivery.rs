use super::{acp_plan_service::AcpPlanService, error::AppError};
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
use std::future::Future;
use tokio_util::sync::CancellationToken;

#[derive(serde::Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Request {
    List {
        #[serde(default, deserialize_with = "present")]
        after: Option<String>,
        #[serde(default, deserialize_with = "present")]
        limit: Option<u16>,
    },
    Read {
        plan_id: String,
    },
    History {
        plan_id: String,
    },
    Save {
        plan_id: String,
        input: Value,
    },
    Delete {
        plan_id: String,
        expected_revision: u64,
    },
    Stage {
        plan_id: String,
        project_id: String,
        attachment: Value,
    },
}
// 可省略分页字段，但显式 null 不能冒充缺省；与共享 TypeBox 请求契约一致。
fn present<'de, T: serde::Deserialize<'de>, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}
fn identity(id: &str) -> Result<(), AppError> {
    if id.is_empty() || id.encode_utf16().count() > 256 {
        Err(AppError::ScheduledTaskInvalid)
    } else {
        Ok(())
    }
}
/// 交付层仅固定 desktop 来源；不开放任意 catalog 操作，也不把目录覆盖传给 ACP。
pub(super) async fn deliver<F, Fut>(
    service: &AcpPlanService,
    catalog: &LocalCatalog,
    request: Value,
    preview: F,
    cancel: &CancellationToken,
) -> Result<Value, AppError>
where
    F: FnOnce(String, String, Value) -> Fut,
    Fut: Future<Output = Result<Value, AppError>>,
{
    if cancel.is_cancelled() {
        return Err(AppError::RequestCancelled);
    }
    let request: Request =
        serde_json::from_value(request).map_err(|_| AppError::ScheduledTaskInvalid)?;
    match request {
        Request::List { after, limit } => {
            let limit = limit.unwrap_or(20);
            if !(1..=100).contains(&limit)
                || after
                    .as_ref()
                    .is_some_and(|s| s.encode_utf16().count() > 256)
            {
                return Err(AppError::ScheduledTaskInvalid);
            }
            let mut query = json!({"source":"desktop","limit":limit});
            if let Some(after) = after {
                query["after"] = json!(after);
            }
            Ok(catalog.call("acp.plan.list", query).await?)
        }
        Request::Read { plan_id } => {
            identity(&plan_id)?;
            let view = service.read(&plan_id).await?;
            if view.is_null() {
                return Err(AppError::ScheduledTaskNotFound);
            }
            Ok(view)
        }
        Request::History { plan_id } => {
            identity(&plan_id)?;
            // 历史不要求项目仍存在，也不启动 agent 或读取完整计划快照。
            let history = catalog
                .call(
                    "acp.plan.history",
                    json!({"source":"desktop","scheduleId":plan_id}),
                )
                .await?;
            if history.is_null() {
                return Err(AppError::ScheduledTaskNotFound);
            }
            Ok(history)
        }
        Request::Save { plan_id, input } => {
            identity(&plan_id)?;
            service
                .save(
                    &plan_id,
                    input,
                    preview,
                    || chrono::Utc::now().timestamp_millis(),
                    cancel,
                )
                .await
        }
        Request::Delete {
            plan_id,
            expected_revision,
        } => {
            identity(&plan_id)?;
            if !(1..=9_007_199_254_740_991).contains(&expected_revision) {
                return Err(AppError::ScheduledTaskInvalid);
            }
            if !service.delete(&plan_id, expected_revision).await? {
                return Err(AppError::ScheduledTaskConfigConflict);
            }
            Ok(json!({"deleted":true}))
        }
        Request::Stage {
            plan_id,
            project_id,
            attachment,
        } => {
            identity(&plan_id)?;
            if project_id.is_empty() || project_id.encode_utf16().count() > 128 {
                return Err(AppError::ScheduledTaskInvalid);
            }
            service
                .stage(&plan_id, &project_id, &attachment, cancel)
                .await
        }
    }
}
#[cfg(test)]
#[path = "acp_plan_delivery_tests.rs"]
mod tests;
