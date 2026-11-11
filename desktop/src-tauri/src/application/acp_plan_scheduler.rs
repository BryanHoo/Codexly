use super::error::AppError;
use crate::infrastructure::local_catalog::LocalCatalog;
use futures_util::FutureExt;
use serde_json::{Value, json};
use std::future::Future;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Scan {
    Recovery(Option<String>),
    Due(Option<Value>),
}
pub(super) struct Batch {
    pub next: Option<Scan>,
    pub errors: Vec<Value>,
}
pub(super) async fn scan<F, Fut>(
    store: &LocalCatalog,
    execute: &mut F,
    now: i64,
    cursor: Scan,
    limit: u16,
    stop: &CancellationToken,
) -> Result<Batch, AppError>
where
    F: FnMut(String, String) -> Fut,
    Fut: Future<Output = Result<Value, AppError>>,
{
    let mut errors = Vec::new();
    if stop.is_cancelled() {
        return Ok(Batch {
            next: Some(Scan::Recovery(None)),
            errors,
        });
    }
    let (work, next) = match cursor {
        Scan::Recovery(after) => {
            let mut query = json!({"source":"desktop","limit":limit});
            if let Some(after) = after {
                query["after"] = json!(after);
            }
            let page = store.call("acp.plan.active", query).await?;
            let work = page["data"]
                .as_array()
                .ok_or(AppError::ScheduledTaskInvalid)?
                .clone();
            let next = page["nextCursor"]
                .as_str()
                .map(|s| Scan::Recovery(Some(s.to_owned())))
                .unwrap_or(Scan::Due(None));
            (work, Some(next))
        }
        Scan::Due(after) => {
            let found = super::acp_plan_discovery::discover(store, now, limit, after).await?;
            for error in found["errors"]
                .as_array()
                .ok_or(AppError::ScheduledTaskInvalid)?
            {
                errors.push(json!({"scheduleId":error["scheduleId"],"message":error["message"].as_str().unwrap_or("Invalid schedule error").chars().take(1024).collect::<String>()}));
            }
            let next = if found["nextCursor"].is_null() {
                None
            } else {
                Some(Scan::Due(Some(found["nextCursor"].clone())))
            };
            (
                found["claims"]
                    .as_array()
                    .ok_or(AppError::ScheduledTaskInvalid)?
                    .clone(),
                next,
            )
        }
    };
    // 每项执行在数据库事务外等待；停止时保留已领取但未投递的记录供下次恢复。
    for item in work {
        if stop.is_cancelled() {
            return Ok(Batch {
                next: Some(Scan::Recovery(None)),
                errors,
            });
        }
        let id = item["scheduleId"]
            .as_str()
            .ok_or(AppError::ScheduledTaskInvalid)?;
        let run = item["runId"]
            .as_str()
            .ok_or(AppError::ScheduledTaskInvalid)?;
        if let Err(error) = execute(id.to_owned(), run.to_owned()).await {
            errors.push(json!({"scheduleId":id,"message":error.to_string().chars().take(1024).collect::<String>()}));
        }
    }
    Ok(Batch { next, errors })
}

#[cfg(test)]
#[path = "acp_plan_scheduler_tests.rs"]
mod tests;

pub(super) async fn run<F, Fut, C, R>(
    store: &LocalCatalog,
    mut execute: F,
    wake: &tokio::sync::Notify,
    stop: &CancellationToken,
    clock: C,
    mut report: R,
) -> Result<(), AppError>
where
    F: FnMut(String, String) -> Fut,
    Fut: Future<Output = Result<Value, AppError>>,
    C: Fn() -> i64,
    R: FnMut(Value),
{
    let mut cursor = Scan::Recovery(None);
    let mut at = clock();
    loop {
        if stop.is_cancelled() {
            return Ok(());
        }
        let batch = scan(store, &mut execute, at, cursor, 20, stop).await;
        if stop.is_cancelled() {
            return Ok(());
        }
        let mut wait = 60000;
        match batch {
            Ok(batch) => {
                for error in batch.errors {
                    report(error);
                }
                // Notify 只保留一次唤醒；批次内的变更在交还执行权后合并生效。
                if wake.notified().now_or_never().is_some() {
                    cursor = Scan::Recovery(None);
                    at = clock();
                    tokio::task::yield_now().await;
                    continue;
                }
                if let Some(next) = batch.next {
                    cursor = next;
                    tokio::task::yield_now().await;
                    continue;
                }
                match store
                    .call("acp.plan.nextDue", json!({"source":"desktop","after":at}))
                    .await
                {
                    Ok(next) => {
                        let now = clock();
                        if let Some(next) = next.as_i64() {
                            wait = (next - now).clamp(0, 60000) as u64;
                        }
                    }
                    Err(error) => report(
                        json!({"scheduleId":null,"message":error.to_string().chars().take(1024).collect::<String>()}),
                    ),
                }
            }
            Err(error) => report(
                json!({"scheduleId":null,"message":error.to_string().chars().take(1024).collect::<String>()}),
            ),
        }
        // 停止只中断等待；已开始的 ACP 执行由 scan 串行等待，不能取消未知提交。
        tokio::select! {biased;
         _=stop.cancelled()=>return Ok(()),
         _=wake.notified()=>{},
         _=tokio::time::sleep(Duration::from_millis(wait))=>{},
        }
        cursor = Scan::Recovery(None);
        at = clock();
    }
}

#[cfg(test)]
#[path = "acp_plan_scheduler_loop_tests.rs"]
mod loop_tests;
