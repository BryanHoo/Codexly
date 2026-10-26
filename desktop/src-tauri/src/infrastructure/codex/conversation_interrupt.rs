use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::{AppServerConnection, connection::ConnectionError};
use crate::domain::conversation::AgentTurnActionResponse;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnInterruptParams<'a> {
    thread_id: &'a str,
    turn_id: &'a str,
}

pub async fn interrupt_turn(
    connection: &AppServerConnection,
    task_id: String,
    turn_id: String,
) -> Result<AgentTurnActionResponse, ConnectionError> {
    let result: Result<Value, ConnectionError> = connection
        .request(
            "turn/interrupt",
            &TurnInterruptParams {
                thread_id: &task_id,
                turn_id: &turn_id,
            },
            Duration::from_secs(30),
        )
        .await;
    match result {
        Ok(_) => {}
        // 与 Web 保持一致：请求到达前回合已结束时，停止目标已经达成。
        // 必须同时匹配错误码和完整消息；其他故障继续传播，完成状态仍由原生事件更新。
        Err(ConnectionError::Request {
            code: -32600,
            message,
        }) if message == "no active turn to interrupt" => {}
        Err(error) => return Err(error),
    }
    Ok(AgentTurnActionResponse {
        status: "interrupting",
        task_id,
        turn_id,
    })
}
