use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{
    AppServerConnection,
    conversation_background::{list_background_terminals, terminate_background_terminal},
};

#[tokio::test]
async fn unloaded_thread_should_have_no_running_background_terminals() {
    for (method, missing_thread) in [("list", true), ("terminate", true), ("terminate", false)] {
        let (client, server) = duplex(8 * 1024);
        let (client_reader, client_writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(client_reader, client_writer);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(
                request["method"],
                format!("thread/backgroundTerminals/{method}")
            );
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"], "error": {
                            "code": -32600,
                            "message": if missing_thread { "thread not found: thread-a" } else { "permission denied" }
                        }})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        if method == "list" {
            assert!(
                list_background_terminals(&connection, "thread-a")
                    .await
                    .unwrap()
                    .data
                    .is_empty()
            );
        } else {
            let response = terminate_background_terminal(&connection, "thread-a", "42").await;
            assert_eq!(response.is_ok(), missing_thread);
        }
        server_task.await.unwrap();
    }
}

#[tokio::test]
async fn native_background_terminal_commands_should_map_protocol_contract() {
    let (client, server) = duplex(16 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let list_request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(list_request["method"], "thread/backgroundTerminals/list");
        assert_eq!(list_request["params"]["threadId"], "thread-a");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": list_request["id"].clone(), "result": {
                        "data": [{
                            "itemId": "item-a", "processId": "42", "command": "pnpm check",
                            "cwd": "/work/a", "osPid": 42, "cpuPercent": 1.5, "rssKb": 1024
                        }],
                        "nextCursor": null
                    }})
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let terminate_request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(
            terminate_request["method"],
            "thread/backgroundTerminals/terminate"
        );
        assert_eq!(terminate_request["params"]["processId"], "42");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": terminate_request["id"].clone(), "result": {"terminated": true}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let page = list_background_terminals(&connection, "thread-a")
        .await
        .expect("terminals should map");
    assert_eq!(page.data[0].id, "42");
    assert_eq!(page.data[0].item_id, "item-a");
    assert_eq!(page.data[0].cwd, "/work/a");

    let response = terminate_background_terminal(&connection, "thread-a", "42")
        .await
        .expect("terminal should terminate");
    assert_eq!(response.status, "terminated");
    assert_eq!(response.terminal_id, "42");
    server_task.await.unwrap();
}

#[tokio::test]
async fn native_background_terminal_termination_should_confirm_already_exited_process() {
    for still_running in [false, true] {
        let (client, server) = duplex(8 * 1024);
        let (client_reader, client_writer) = split(client);
        let (server_reader, mut server_writer) = split(server);
        let connection = AppServerConnection::new(client_reader, client_writer);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_reader).lines();
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"], "result": {"terminated": false}})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            // 终止返回 false 不能区分已退出和终止失败，必须再查权威列表。
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], "thread/backgroundTerminals/list");
            let data = if still_running {
                json!([{"itemId": "item-a", "processId": "42", "command": "sleep 30", "cwd": "/work/a"}])
            } else {
                json!([])
            };
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"], "result": {"data": data, "nextCursor": null}})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let response = terminate_background_terminal(&connection, "thread-a", "42").await;
        // 仅确认进程已消失才视为成功，仍存活的终端必须保留失败语义。
        assert_eq!(response.is_ok(), !still_running);
        if !still_running {
            let response = response.unwrap();
            assert_eq!(response.terminal_id, "42");
            assert_eq!(response.status, "terminated");
        }
        server_task.await.unwrap();
    }
}
