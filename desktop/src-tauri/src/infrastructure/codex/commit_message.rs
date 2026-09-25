use std::{path::Path, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{
    AppServerConnection,
    connection::ConnectionError,
    conversation_commands::{ThreadConfig, thread_config},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_PROMPT: &str = "根据给定的 Git 变更生成准确、简洁的 Conventional Commit message。首行不超过 72 个字符；必要时添加最多 3 条以 `- ` 开头的正文。只描述实际变更，不添加 Markdown 代码块或解释。";

pub struct CommitMessageSettings {
    pub model: String,
    pub prompt: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadStartParams<'a> {
    approval_policy: &'static str,
    config: ThreadConfig,
    cwd: &'a str,
    developer_instructions: &'static str,
    ephemeral: bool,
    history_mode: &'static str,
    model: &'a str,
    runtime_workspace_roots: [&'a str; 1],
    sandbox: &'static str,
}

#[derive(Deserialize)]
struct ThreadStartResponse {
    thread: ThreadIdentity,
}

#[derive(Deserialize)]
struct ThreadIdentity {
    id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnStartParams<'a> {
    approval_policy: &'static str,
    effort: &'static str,
    input: [Value; 1],
    model: &'a str,
    output_schema: Value,
    sandbox_policy: Value,
    thread_id: &'a str,
}

#[derive(Deserialize)]
struct TurnStartResponse {
    turn: TurnIdentity,
}

#[derive(Deserialize)]
struct TurnIdentity {
    id: String,
}

#[derive(Deserialize)]
struct GeneratedMessage {
    message: String,
}

pub fn resolve_commit_message_settings(settings: &Value) -> CommitMessageSettings {
    let model = settings
        .get("commitMessageModel")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("gpt-5.6-luna")
        .to_owned();
    let prompt = settings
        .get("commitMessagePrompt")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_PROMPT)
        .to_owned();
    CommitMessageSettings { model, prompt }
}

pub async fn start_commit_message_thread(
    connection: &AppServerConnection,
    root: &Path,
    model: &str,
) -> Result<String, ConnectionError> {
    let cwd = root.to_str().ok_or(ConnectionError::InvalidMessage)?;
    let response: ThreadStartResponse = connection
        .request(
            "thread/start",
            &ThreadStartParams {
                approval_policy: "never",
                config: thread_config(),
                cwd,
                developer_instructions: "Do not call tools. Generate only the requested commit message from the supplied changes.",
                ephemeral: true,
                history_mode: "paginated",
                model,
                runtime_workspace_roots: [cwd],
                sandbox: "read-only",
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    (!response.thread.id.is_empty())
        .then_some(response.thread.id)
        .ok_or(ConnectionError::InvalidMessage)
}

pub async fn start_commit_message_turn(
    connection: &AppServerConnection,
    thread_id: &str,
    model: &str,
    instruction: &str,
    changes: &str,
) -> Result<(), ConnectionError> {
    let prompt = format!("{instruction}\n\n以下是选中的 Git 变更：\n{changes}");
    let response: TurnStartResponse = connection
        .request(
            "turn/start",
            &TurnStartParams {
                approval_policy: "never",
                effort: "low",
                input: [json!({"text": prompt, "text_elements": [], "type": "text"})],
                model,
                output_schema: json!({
                    "additionalProperties": false,
                    "properties": {"message": {"minLength": 1, "type": "string"}},
                    "required": ["message"],
                    "type": "object"
                }),
                sandbox_policy: json!({"networkAccess": false, "type": "readOnly"}),
                thread_id,
            },
            REQUEST_TIMEOUT,
        )
        .await?;
    (!response.turn.id.is_empty())
        .then_some(())
        .ok_or(ConnectionError::InvalidMessage)
}

pub fn parse_commit_message_output(output: &str) -> Result<String, ConnectionError> {
    let generated: GeneratedMessage = serde_json::from_str(output.trim())?;
    let message = generated.message.trim();
    if message.is_empty() || message.len() > 10_000 {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(message.to_owned())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

    use super::{
        AppServerConnection, parse_commit_message_output, resolve_commit_message_settings,
        start_commit_message_thread, start_commit_message_turn,
    };

    #[test]
    fn structured_output_should_return_only_the_commit_message() {
        let message = parse_commit_message_output(
            r#"{"message":"fix(git): 调用模型生成提交信息\n\n- 修复固定文案"}"#,
        )
        .unwrap();
        assert_eq!(message, "fix(git): 调用模型生成提交信息\n\n- 修复固定文案");
    }

    #[tokio::test]
    async fn generation_should_use_configured_model_on_an_ephemeral_turn() {
        let (client, server) = duplex(32 * 1024);
        let (client_reader, client_writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(client_reader, client_writer);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            for (method, result) in [
                ("thread/start", json!({"thread": {"id": "thread-message"}})),
                ("turn/start", json!({"turn": {"id": "turn-message"}})),
            ] {
                let request: Value = serde_json::from_str(
                    &lines
                        .next_line()
                        .await
                        .unwrap()
                        .expect("request should exist"),
                )
                .unwrap();
                assert_eq!(request["method"], method);
                if method == "thread/start" {
                    assert_eq!(request["params"]["model"], "gpt-commit");
                    assert_eq!(request["params"]["ephemeral"], true);
                    assert_eq!(request["params"]["sandbox"], "read-only");
                    assert_eq!(
                        request["params"]["config"]["tools.update_plan.enabled"],
                        true
                    );
                }
                if method == "turn/start" {
                    assert_eq!(request["params"]["model"], "gpt-commit");
                    assert_eq!(request["params"]["outputSchema"]["type"], "object");
                    assert!(
                        request["params"]["input"][0]["text"]
                            .as_str()
                            .unwrap()
                            .contains("selected change")
                    );
                }
                let response = json!({"id": request["id"].clone(), "result": result});
                server_writer
                    .write_all(
                        format!("{}\n", serde_json::to_string(&response).unwrap()).as_bytes(),
                    )
                    .await
                    .unwrap();
            }
        });

        let settings = resolve_commit_message_settings(&json!({
            "commitMessageModel": "gpt-commit",
            "commitMessagePrompt": "生成中文提交信息"
        }));
        let thread_id =
            start_commit_message_thread(&connection, Path::new("/work/project"), &settings.model)
                .await
                .unwrap();
        start_commit_message_turn(
            &connection,
            &thread_id,
            &settings.model,
            &settings.prompt,
            "selected change",
        )
        .await
        .unwrap();
        server_task.await.unwrap();
    }
}
