use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{
    AppServerConnection,
    connection::ConnectionError,
    conversation::{NativeTurn, map_turn},
    conversation_commands::{ThreadConfig, thread_config},
    tasks::{NativeThread, map_task, read_native_task, read_task, validate_task_project},
};
use crate::domain::conversation::{AgentGoal, AgentTaskSettings};
use crate::domain::{conversation::AgentTurn, sidebar::AgentTaskMutationResponse};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[cfg(test)]
#[path = "conversation_fork_settings_tests.rs"]
mod fork_settings_tests;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewTaskResponse {
    pub task_id: String,
    pub turn: AgentTurn,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactTaskResponse {
    pub status: &'static str,
    pub task_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewStartParams<'a> {
    thread_id: &'a str,
    target: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewStartResponse {
    turn: NativeTurn,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadIdParams<'a> {
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadForkParams<'a> {
    config: ForkThreadConfig<'a>,
    model: &'a str,
    exclude_turns: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_turn_id: Option<&'a str>,
    thread_id: &'a str,
}

#[derive(Serialize)]
struct ForkThreadConfig<'a> {
    #[serde(flatten)]
    base: ThreadConfig,
    model_reasoning_effort: &'a str,
}

#[derive(Deserialize)]
struct ThreadForkResponse {
    thread: NativeThread,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NativeGoal {
    created_at: i64,
    objective: String,
    status: String,
    thread_id: String,
    time_used_seconds: i64,
    token_budget: Option<i64>,
    tokens_used: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
struct GoalGetResponse {
    goal: Option<NativeGoal>,
}

#[derive(Debug, Serialize)]
pub struct GoalUpdateResponse {
    pub goal: AgentGoal,
}

#[derive(Deserialize)]
struct NativeGoalUpdateResponse {
    goal: NativeGoal,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GoalClearResponse {
    pub cleared: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackUploadResult {
    pub status: &'static str,
    pub task_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackUploadParams<'a> {
    classification: &'a str,
    include_logs: bool,
    reason: &'a str,
    thread_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackUploadResponse {
    thread_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoalUpdateParams<'a> {
    thread_id: &'a str,
    status: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoalObjectiveParams<'a> {
    objective: &'a str,
    status: &'static str,
    thread_id: &'a str,
}

pub async fn get_goal(
    connection: &AppServerConnection,
    task_id: &str,
) -> Result<Option<AgentGoal>, ConnectionError> {
    let response: GoalGetResponse = connection
        .request(
            "thread/goal/get",
            &ThreadIdParams { thread_id: task_id },
            REQUEST_TIMEOUT,
        )
        .await?;
    response
        .goal
        .map(|goal| map_native_goal(goal, task_id))
        .transpose()
}

pub async fn update_goal(
    connection: &AppServerConnection,
    task_id: &str,
    status: &str,
) -> Result<GoalUpdateResponse, ConnectionError> {
    let status = match status {
        "active" => "active",
        "paused" => "paused",
        _ => return Err(ConnectionError::InvalidMessage),
    };
    let response: NativeGoalUpdateResponse = connection
        .request(
            "thread/goal/set",
            &GoalUpdateParams {
                thread_id: task_id,
                status,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(GoalUpdateResponse {
        goal: map_native_goal(response.goal, task_id)?,
    })
}

pub async fn set_goal_objective(
    connection: &AppServerConnection,
    task_id: &str,
    objective: &str,
) -> Result<GoalUpdateResponse, ConnectionError> {
    let objective = crate::domain::goal_input::validate_objective(objective)
        .map_err(|_| ConnectionError::InvalidMessage)?;
    let response: NativeGoalUpdateResponse = connection
        .request(
            "thread/goal/set",
            &GoalObjectiveParams {
                objective,
                status: "active",
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    let goal = map_native_goal(response.goal, task_id)?;
    if goal.objective != objective {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(GoalUpdateResponse { goal })
}

pub async fn clear_goal(
    connection: &AppServerConnection,
    task_id: &str,
) -> Result<GoalClearResponse, ConnectionError> {
    connection
        .request(
            "thread/goal/clear",
            &ThreadIdParams { thread_id: task_id },
            REQUEST_TIMEOUT,
        )
        .await
}

pub async fn upload_feedback(
    connection: &AppServerConnection,
    task_id: &str,
    classification: &str,
    reason: &str,
    include_logs: bool,
) -> Result<FeedbackUploadResult, ConnectionError> {
    if classification.trim().is_empty()
        || classification.chars().count() > 100
        || reason.trim().is_empty()
        || reason.chars().count() > 4_000
    {
        return Err(ConnectionError::InvalidMessage);
    }
    let response: FeedbackUploadResponse = connection
        .request(
            "feedback/upload",
            &FeedbackUploadParams {
                classification,
                include_logs,
                reason,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    if response.thread_id != task_id {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(FeedbackUploadResult {
        status: "sent",
        task_id: response.thread_id,
    })
}

pub(super) fn map_native_goal(
    goal: NativeGoal,
    task_id: &str,
) -> Result<AgentGoal, ConnectionError> {
    if goal.thread_id != task_id
        || goal.objective.trim().is_empty()
        || goal.time_used_seconds < 0
        || goal.tokens_used < 0
        || goal.token_budget.is_some_and(|budget| budget < 0)
    {
        return Err(ConnectionError::InvalidMessage);
    }
    let status = match goal.status.as_str() {
        "active" => "active",
        "paused" => "paused",
        "blocked" => "blocked",
        "usageLimited" => "usage_limited",
        "budgetLimited" => "budget_limited",
        "complete" => "complete",
        _ => return Err(ConnectionError::InvalidMessage),
    };
    Ok(AgentGoal {
        created_at: super::sidebar::unix_seconds_to_rfc3339(goal.created_at),
        objective: goal.objective,
        status,
        time_used_seconds: goal.time_used_seconds,
        token_budget: goal.token_budget,
        tokens_used: goal.tokens_used,
        updated_at: super::sidebar::unix_seconds_to_rfc3339(goal.updated_at),
    })
}

pub async fn start_review(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
    target: &Value,
) -> Result<ReviewTaskResponse, ConnectionError> {
    read_task(connection, project_id.to_owned(), task_id.to_owned()).await?;
    let response: ReviewStartResponse = connection
        .request(
            "review/start",
            &ReviewStartParams {
                thread_id: task_id,
                target: map_review_target(target)?,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(ReviewTaskResponse {
        task_id: task_id.to_owned(),
        turn: map_turn(response.turn)?,
    })
}

pub async fn compact_task(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<CompactTaskResponse, ConnectionError> {
    read_task(connection, project_id.to_owned(), task_id.to_owned()).await?;
    let _: Value = connection
        .request(
            "thread/compact/start",
            &ThreadIdParams { thread_id: task_id },
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(CompactTaskResponse {
        status: "compacting",
        task_id: task_id.to_owned(),
    })
}

pub async fn fork_task(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
    last_turn_id: Option<&str>,
    settings: &mut AgentTaskSettings,
) -> Result<AgentTaskMutationResponse, ConnectionError> {
    let source = read_native_task(connection, project_id, task_id).await?;
    if source.id != task_id {
        return Err(ConnectionError::InvalidMessage);
    }
    // 源线程实际配置优先于本地默认值；更新同一份设置，供调用方保存到新任务。
    // Fork 不会自动继承模型与思考强度，必须显式传递；缺失字段分别沿用源任务设置。
    if let Some(model) = source.model {
        settings.model = model;
    }
    if let Some(effort) = source.reasoning_effort {
        settings.reasoning_effort = effort;
    }
    if !settings.is_valid() {
        return Err(ConnectionError::InvalidMessage);
    }
    let response: ThreadForkResponse = connection
        .request(
            "thread/fork",
            &ThreadForkParams {
                config: ForkThreadConfig {
                    base: thread_config(),
                    model_reasoning_effort: &settings.reasoning_effort,
                },
                model: &settings.model,
                // 历史由分页接口加载，Fork 仅返回元数据，避免极限会话形成超大单帧。
                exclude_turns: true,
                last_turn_id,
                thread_id: task_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    validate_task_project(&response.thread, project_id)?;
    Ok(AgentTaskMutationResponse {
        task: map_task(response.thread, project_id),
    })
}

fn map_review_target(target: &Value) -> Result<Value, ConnectionError> {
    let target = target.as_object().ok_or(ConnectionError::InvalidMessage)?;
    let kind = target
        .get("type")
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)?;
    match kind {
        "uncommitted_changes" => Ok(json!({"type": "uncommittedChanges"})),
        "base_branch" => Ok(json!({
            "branch": required_string(target, "branch")?,
            "type": "baseBranch",
        })),
        "commit" => Ok(json!({
            "sha": required_string(target, "sha")?,
            "title": target.get("title").cloned().unwrap_or(Value::Null),
            "type": "commit",
        })),
        "custom" => Ok(json!({
            "instructions": required_string(target, "instructions")?,
            "type": "custom",
        })),
        _ => Err(ConnectionError::InvalidMessage),
    }
}

fn required_string<'a>(
    target: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    target
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)
}
