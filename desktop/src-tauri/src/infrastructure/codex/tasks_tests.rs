use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{
    archive_task, delete_task, list_completed_tasks, list_tasks, pin_task, rename_task,
    task_working_directory, unarchive_task, unsubscribe_task,
};
use crate::{
    domain::sidebar::{ListCompletedTasksInput, ListTasksInput},
    infrastructure::codex::connection::AppServerConnection,
};

const PINNED_SECTION_ID: &str = "01984de2-8f74-7c91-a3b2-5c5e937cf318";

#[tokio::test]
async fn list_tasks_should_filter_and_map_native_threads() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
            .expect("request should be JSON");
        assert_eq!(request["method"], "thread/list");
        assert_eq!(request["params"]["projectId"], "project-a");
        assert_eq!(request["params"]["sectionId"], PINNED_SECTION_ID);
        assert_eq!(request["params"]["sortKey"], "recency_at");
        assert_eq!(request["params"]["sortDirection"], "desc");
        assert_eq!(request["params"]["modelProviders"], json!([]));
        assert_eq!(request["params"]["searchTerm"], "fix");
        assert_eq!(request["params"]["cursor"], "cursor-a");
        assert_eq!(request["params"]["limit"], 20);
        let id = &request["id"];
        let response = json!({
            "id": id,
            "result": {
                "data": [{
                    "id": "thread-a",
                    "name": "  Fixed title  ",
                    "preview": "ignored",
                    "projectId": "project-a",
                    "section": {"id": PINNED_SECTION_ID, "name": "Pinned", "appearance": null},
                    "status": {"type": "idle"},
                    "updatedAt": 1735689600
                }],
                "nextCursor": "cursor-b",
                "backwardsCursor": null
            }
        });
        server_writer
            .write_all(format!("{}\n", serde_json::to_string(&response).unwrap()).as_bytes())
            .await
            .unwrap();
    });

    let page = list_tasks(
        &connection,
        ListTasksInput {
            archived: Some(false),
            cursor: Some("cursor-a".into()),
            limit: Some(20),
            pinned: Some(true),
            project_id: "project-a".into(),
            search_term: Some("fix".into()),
        },
    )
    .await
    .expect("tasks should map");

    assert_eq!(page.data[0].id, "thread-a");
    assert_eq!(page.data[0].project_id, "project-a");
    assert_eq!(page.data[0].title, "Fixed title");
    assert!(page.data[0].pinned);
    assert_eq!(page.data[0].updated_at, "2025-01-01T00:00:00Z");
    assert_eq!(page.next_cursor.as_deref(), Some("cursor-b"));
    server_task.await.unwrap();
}

#[tokio::test]
async fn list_completed_tasks_should_fill_cross_project_page_from_idle_threads() {
    let (client, server) = duplex(16 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for (cursor, limit, data, next_cursor) in [
            (
                None,
                10,
                json!([
                    task_thread_with("running-a", "project-a", "active", 1735689602),
                    task_thread_with("done-a", "project-a", "idle", 1735689601)
                ]),
                Some("cursor-b"),
            ),
            (
                Some("cursor-b"),
                9,
                json!([
                    task_thread_with("failed-b", "project-b", "systemError", 1735689600),
                    task_thread_with("done-b", "project-b", "notLoaded", 1735689599)
                ]),
                None,
            ),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], "thread/list");
            assert!(request["params"].get("projectId").is_none());
            assert_eq!(request["params"]["cursor"].as_str(), cursor);
            assert_eq!(request["params"]["limit"], limit);
            let response = json!({
                "id": request["id"].clone(),
                "result": {
                    "backwardsCursor": null,
                    "data": data,
                    "nextCursor": next_cursor
                }
            });
            server_writer
                .write_all(format!("{}\n", serde_json::to_string(&response).unwrap()).as_bytes())
                .await
                .unwrap();
        }
    });

    let page = list_completed_tasks(
        &connection,
        ListCompletedTasksInput {
            cursor: None,
            limit: None,
            project_id: None,
        },
    )
    .await
    .expect("completed tasks should map");

    assert_eq!(
        page.data
            .iter()
            .map(|task| (task.id.as_str(), task.project_id.as_str()))
            .collect::<Vec<_>>(),
        [("done-a", "project-a"), ("done-b", "project-b")]
    );
    assert_eq!(page.next_cursor, None);
    server_task.await.unwrap();
}

fn task_thread(title: &str, pinned: bool) -> Value {
    json!({
        "id": "thread-a",
        "name": title,
        "preview": "preview",
        "projectId": "project-a",
        "section": pinned.then(|| json!({"id": PINNED_SECTION_ID, "name": "Pinned", "appearance": null})),
        "status": {"type": "idle"},
        "updatedAt": 1735689600
    })
}

fn task_thread_with(id: &str, project_id: &str, status: &str, updated_at: i64) -> Value {
    json!({
        "id": id,
        "name": id,
        "preview": id,
        "projectId": project_id,
        "section": null,
        "status": {"type": status},
        "updatedAt": updated_at
    })
}

#[tokio::test]
async fn task_working_directory_should_read_native_thread_cwd() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "thread/read");
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": request["id"].clone(), "result": {"thread": {
                        "cwd": "/app-data/temporary-workspaces/task-1",
                        "id": "thread-temp", "name": null, "preview": "",
                        "projectId": null, "section": null,
                        "status": {"type": "idle"}, "updatedAt": 1735689600
                    }}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let cwd = task_working_directory(&connection, "temporary", "thread-temp")
        .await
        .unwrap();
    assert_eq!(
        cwd,
        std::path::Path::new("/app-data/temporary-workspaces/task-1")
    );
    server_task.await.unwrap();
}

#[tokio::test]
async fn unsubscribe_task_should_preserve_active_runtime_and_release_idle_thread() {
    let (client, server) = duplex(16 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let cases = [
            ("thread/read", json!({"thread": task_thread("Idle", false)})),
            (
                "thread/backgroundTerminals/list",
                json!({"data": [], "nextCursor": null}),
            ),
            ("thread/unsubscribe", json!({"status": "unsubscribed"})),
        ];
        for (method, result) in cases {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"]["threadId"], "thread-a");
            server_writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({"id": request["id"].clone(), "result": result})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        }
    });

    let response = unsubscribe_task(&connection, "project-a", "thread-a")
        .await
        .expect("idle thread should unsubscribe");
    assert_eq!(response.status, "unsubscribed");
    assert_eq!(response.task_id, "thread-a");
    server_task.await.unwrap();
}

#[tokio::test]
async fn unsubscribe_task_should_report_busy_without_releasing_active_thread() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(request["method"], "thread/read");
        let mut thread = task_thread("Running", false);
        thread["status"] = json!({"type": "active", "activeFlags": []});
        server_writer
            .write_all(
                format!(
                    "{}\n",
                    json!({"id": request["id"].clone(), "result": {"thread": thread}})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let response = unsubscribe_task(&connection, "project-a", "thread-a")
        .await
        .expect("active thread should report busy");
    assert_eq!(response.status, "busy");
    server_task.await.unwrap();
}

#[tokio::test]
async fn task_mutations_should_complete_native_protocol_round_trips() {
    let (client, server) = duplex(32 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        for (method, result) in [
            (
                "thread/read",
                json!({"thread": task_thread("Original", false)}),
            ),
            ("thread/name/set", json!({})),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", false)}),
            ),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", false)}),
            ),
            ("thread/section/move", json!({})),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", true)}),
            ),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", true)}),
            ),
            ("thread/archive", json!({})),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", true)}),
            ),
            (
                "thread/unarchive",
                json!({"thread": task_thread("Renamed", true)}),
            ),
            (
                "thread/read",
                json!({"thread": task_thread("Renamed", true)}),
            ),
            ("thread/delete", json!({})),
        ] {
            let request: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"]["threadId"], "thread-a");
            if method == "thread/name/set" {
                assert_eq!(request["params"]["name"], "Renamed");
            }
            if method == "thread/section/move" {
                assert_eq!(request["params"]["sectionId"], PINNED_SECTION_ID);
            }
            let response = json!({"id": request["id"].clone(), "result": result});
            server_writer
                .write_all(format!("{}\n", serde_json::to_string(&response).unwrap()).as_bytes())
                .await
                .unwrap();
        }
    });

    let renamed = rename_task(
        &connection,
        "project-a".into(),
        "thread-a".into(),
        " Renamed ".into(),
    )
    .await
    .unwrap();
    assert_eq!(renamed.task.title, "Renamed");
    let pinned = pin_task(&connection, "project-a".into(), "thread-a".into(), true)
        .await
        .unwrap();
    assert!(pinned.task.pinned);
    assert_eq!(
        archive_task(&connection, "project-a".into(), "thread-a".into())
            .await
            .unwrap()
            .status,
        "archived"
    );
    assert!(
        unarchive_task(&connection, "project-a".into(), "thread-a".into())
            .await
            .unwrap()
            .task
            .pinned
    );
    assert_eq!(
        delete_task(&connection, "project-a".into(), "thread-a".into())
            .await
            .unwrap()
            .response
            .status,
        "deleted"
    );
    server_task.await.unwrap();
}
