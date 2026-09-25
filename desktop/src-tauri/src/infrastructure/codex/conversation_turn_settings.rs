use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{AppServerConnection, connection::ConnectionError};

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LiveReviewerUpdate {
    Applied,
    TargetUnavailable,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewerParams<'a> {
    thread_id: &'a str,
    turn_id: &'a str,
    approvals_reviewer: &'a str,
}

#[derive(Deserialize)]
struct ReviewerResponse {
    status: LiveReviewerUpdate,
}

pub async fn update_live_reviewer(
    connection: &AppServerConnection,
    thread_id: &str,
    turn_id: &str,
    reviewer: &str,
) -> Result<LiveReviewerUpdate, ConnectionError> {
    if !matches!(reviewer, "user" | "auto_review") || turn_id.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    // 只更新精确运行目标的后续审核路由，不改变沙箱、已捕获步骤或模型配置。
    let response: ReviewerResponse = connection
        .request(
            "turn/settings/update",
            &ReviewerParams {
                thread_id,
                turn_id,
                approvals_reviewer: reviewer,
            },
            Duration::from_secs(30),
        )
        .await?;
    Ok(response.status)
}
