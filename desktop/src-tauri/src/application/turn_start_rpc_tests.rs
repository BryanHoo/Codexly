use super::*;
use crate::{
    domain::conversation::{AgentPromptInput, AgentTurnOptions},
    infrastructure::codex,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

#[tokio::test]
async fn turn_start_should_send_only_one_native_turn_rpc_for_repeated_submission() {
    let (client, server) = duplex(8192);
    let (reader, writer) = split(client);
    let connection = Arc::new(codex::AppServerConnection::new(reader, writer));
    let (reader, mut writer) = split(server);
    let peer = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        for (method, result) in [
            (
                "thread/resume",
                json!({"thread": {"id": "task-a", "projectId": "project-a"}}),
            ),
            (
                "turn/start",
                json!({"turn": {"id": "turn-a", "status": "inProgress", "startedAt": 1735689600, "completedAt": null, "error": null, "items": []}}),
            ),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"]["threadId"], "task-a");
            writer
                .write_all(
                    format!("{}\n", json!({"id": request["id"], "result": result})).as_bytes(),
                )
                .await
                .unwrap();
        }
        assert!(
            lines.next_line().await.unwrap().is_none(),
            "replay must not repeat thread/resume or turn/start"
        );
    });
    let registry = TurnStartRegistry::default();
    for _ in 0..2 {
        let input = AgentPromptInput::text("hello");
        let options = AgentTurnOptions::default();
        let identity = fingerprint("project-a", "task-a", &input, &options).unwrap();
        let connection = Arc::clone(&connection);
        let result = registry
            .run("turn-key", identity, async move {
                let response = codex::start_turn(
                    &connection,
                    "project-a".into(),
                    "task-a".into(),
                    input,
                    options,
                    &Default::default(),
                )
                .await
                .map_err(AppError::from)?;
                serde_json::to_value(response).map_err(|_| AppError::CodexRequestFailed)
            })
            .await
            .unwrap();
        assert_eq!(result["turn"]["id"], "turn-a");
        assert_eq!(result["turn"]["status"], "running");
    }
    drop(connection);
    peer.await.unwrap();
}
