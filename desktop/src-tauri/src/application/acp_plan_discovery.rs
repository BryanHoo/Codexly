use super::error::AppError;
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
pub(super) async fn discover(
    store: &LocalCatalog,
    now: i64,
    limit: u16,
    after: Option<Value>,
) -> Result<Value, AppError> {
    let mut query = json!({"source":"desktop","now":now,"limit":limit});
    if let Some(after) = after {
        query["after"] = after;
    }
    let due = store.call("acp.plan.due", query).await?;
    let mut claims = Vec::new();
    let mut errors = Vec::new();
    for item in due.as_array().ok_or(AppError::ScheduledTaskInvalid)? {
        let result = claim_one(store, item, now).await;
        match result {
            Ok(value) if !value.is_null() => claims.push(value),
            Ok(_) => {}
            Err(error) => {
                errors.push(json!({"scheduleId":item["scheduleId"],"message":error.to_string()}))
            }
        }
    }
    let next = due
        .as_array()
        .filter(|items| items.len() == usize::from(limit))
        .and_then(|items| items.last())
        .map(|item| json!({"nextRunAt":item["nextRunAt"],"scheduleId":item["scheduleId"]}));
    Ok(json!({"claims":claims,"errors":errors,"nextCursor":next}))
}

async fn claim_one(store: &LocalCatalog, item: &Value, now: i64) -> Result<Value, AppError> {
    use crate::domain::scheduled_task::ScheduledTaskSchedule;
    let schedule: ScheduledTaskSchedule = serde_json::from_value(item["schedule"].clone())
        .map_err(|_| AppError::ScheduledTaskInvalid)?;
    // 日历计算不占用 Tokio 流式线程，更不持有目录数据库事务；完成后重新做双修订领取。
    let next = tauri::async_runtime::spawn_blocking(move || match &schedule {
        ScheduledTaskSchedule::Once { at_unix_ms } if *at_unix_ms <= now => Ok(None),
        ScheduledTaskSchedule::Once { .. } => Err(AppError::ScheduledTaskInvalid),
        _ => crate::infrastructure::scheduled_tasks::resolve_schedule_runs(&schedule, now, 1)
            .map(|dates| dates.first().copied())
            .map_err(|_| AppError::ScheduledTaskInvalid),
    })
    .await
    .map_err(|_| AppError::ScheduledTaskInvalid)??;
    Ok(store.call("acp.plan.claimRef",json!({"source":"desktop","scheduleId":item["scheduleId"],"expectedRevision":item["revision"],"expectedStateRevision":item["stateRevision"],"now":now,"nextRunAt":next,"runId":uuid::Uuid::new_v4().to_string()})).await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn acp_plan_discovery_should_isolate_invalid_rules_and_advance_once() {
        let root = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(root.path()).unwrap();
        let mut definition: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
        ))
        .unwrap();
        definition["enabled"] = json!(true);
        for id in ["a-bad", "b-once"] {
            definition["schedule"] = if id == "a-bad" {
                json!({"type":"rrule","rrule":"invalid","timezone":"UTC","startAtUnixMs":1})
            } else {
                json!({"type":"once","atUnixMs":10})
            };
            store.call("acp.plan.set",json!({"source":"desktop","scheduleId":id,"definition":definition,"expectedRevision":0})).await.unwrap();
            store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":id,"expectedRevision":1,"expectedStateRevision":0,"nextRunAt":10})).await.unwrap();
        }
        let first = discover(&store, 10, 1, None).await.unwrap();
        assert_eq!(first["claims"], json!([]));
        let result = discover(&store, 10, 1, Some(first["nextCursor"].clone()))
            .await
            .unwrap();
        assert_eq!(result["claims"].as_array().unwrap().len(), 1);
        assert_eq!(first["errors"][0]["scheduleId"], "a-bad");
        assert_eq!(
            store
                .call(
                    "acp.plan.readState",
                    json!({"source":"desktop","scheduleId":"a-bad"})
                )
                .await
                .unwrap()["revision"],
            1
        );
        assert!(
            store
                .call(
                    "acp.plan.readState",
                    json!({"source":"desktop","scheduleId":"b-once"})
                )
                .await
                .unwrap()["nextRunAt"]
                .is_null()
        );
    }
    #[tokio::test]
    async fn acp_plan_discovery_should_match_shared_calendar_cases() {
        let root = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(root.path()).unwrap();
        let cases: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/acp-plan-discovery-times.json"
        ))
        .unwrap();
        let mut definition: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
        ))
        .unwrap();
        definition["enabled"] = json!(true);
        for item in cases.as_array().unwrap() {
            definition["schedule"] = item["schedule"].clone();
            store.call("acp.plan.set",json!({"source":"desktop","scheduleId":item["id"],"definition":definition,"expectedRevision":0})).await.unwrap();
            store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":item["id"],"expectedRevision":1,"expectedStateRevision":0,"nextRunAt":item["now"]})).await.unwrap();
            let result = discover(&store, item["now"].as_i64().unwrap(), 20, None)
                .await
                .unwrap();
            assert_eq!(result["errors"], json!([]));
            assert_eq!(result["claims"].as_array().unwrap().len(), 1);
            assert_eq!(
                store
                    .call(
                        "acp.plan.readState",
                        json!({"source":"desktop","scheduleId":item["id"]})
                    )
                    .await
                    .unwrap()["nextRunAt"],
                item["nextRunAt"]
            );
        }
    }
}
