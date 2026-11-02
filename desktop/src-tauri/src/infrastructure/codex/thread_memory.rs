use super::{AppServerConnection, connection::ConnectionError};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Serialize)]
pub struct ThreadMemory {
    status: &'static str,
    summary: Option<String>,
}

#[derive(Deserialize)]
struct NativeMemory {
    // 缺失字段必须报协议错误；显式 null 则是正常空摘要。
    #[serde(deserialize_with = "Option::<String>::deserialize")]
    summary: Option<String>,
}

pub async fn read_thread_memory(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
) -> Result<ThreadMemory, ConnectionError> {
    // 仅校验元数据归属，不读取历史、不恢复线程，避免改变用户查看时的会话状态。
    super::tasks::read_native_task(connection, project_id, task_id).await?;
    let result: Result<NativeMemory, ConnectionError> = connection
        .request(
            "thread/memory/read",
            &serde_json::json!({ "threadId": task_id }),
            Duration::from_secs(30),
        )
        .await;
    match result {
        Ok(response) => {
            let summary = response.summary;
            Ok(ThreadMemory {
                status: "ready",
                summary,
            })
        }
        Err(ConnectionError::Request {
            code: -32600,
            message,
        }) if message.starts_with("thread not found:") => Ok(ThreadMemory {
            status: "not_loaded",
            summary: None,
        }),
        Err(ConnectionError::Request { code: -32601, .. }) => Ok(ThreadMemory {
            status: "unsupported",
            summary: None,
        }),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn summary_should_require_explicit_string_or_null() {
        assert!(
            serde_json::from_str::<NativeMemory>(r#"{"summary":null}"#)
                .unwrap()
                .summary
                .is_none()
        );
        assert_eq!(
            serde_json::from_str::<NativeMemory>(r#"{"summary":"记忆"}"#)
                .unwrap()
                .summary
                .as_deref(),
            Some("记忆")
        );
        for invalid in [r#"{}"#, r#"{"summary":4}"#, r#"{"summary":[]}"#] {
            assert!(serde_json::from_str::<NativeMemory>(invalid).is_err());
        }
    }
}
