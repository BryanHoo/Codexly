use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

use super::{add_project, list_projects, remove_project, rename_project, reorder_projects};
use crate::infrastructure::codex::connection::AppServerConnection;

fn native_project(id: &str, name: &str, path: &str, position: i64) -> String {
    format!(
        "{{\"id\":\"{id}\",\"name\":\"{name}\",\"roots\":[{{\"path\":\"{path}\"}}],\"metadata\":{{}},\"position\":{position},\"createdAt\":1735689600,\"updatedAt\":1735689600,\"recencyAt\":1735689700}}"
    )
}

#[tokio::test]
async fn list_projects_should_map_codex_projects_in_position_order() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
            .expect("request should be JSON");
        assert_eq!(request["method"], "project/list");
        assert_eq!(request["params"]["limit"], 100);
        assert!(request["params"].get("sortKey").is_none());
        assert!(request["params"].get("sortDirection").is_none());
        let id = &request["id"];
        let project_b = native_project("project-b", "B", "/work/b", 2);
        let project_a = native_project("project-a", "A", "/work/a", 1);
        let response = format!(
            "{{\"id\":{id},\"result\":{{\"data\":[{project_b},{project_a}],\"nextCursor\":null}}}}\n"
        );
        server_writer.write_all(response.as_bytes()).await.unwrap();
    });

    let page = list_projects(&connection)
        .await
        .expect("project list should map");
    assert_eq!(page.data[0].id, "project-a");
    assert_eq!(page.data[0].created_at, "2025-01-01T00:00:00Z");
    assert_eq!(page.data[0].roots[0].path, "/work/a");
    assert_eq!(page.data[0].roots[0].id.len(), 16);
    assert_eq!(page.next_cursor, None);
    server_task.await.unwrap();
}

#[tokio::test]
async fn add_project_should_create_native_project_from_all_roots() {
    let (client, server) = duplex(8 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap())
            .expect("request should be JSON");
        assert_eq!(request["method"], "project/create");
        assert_eq!(request["params"]["name"], "primary");
        assert_eq!(request["params"]["roots"][0]["path"], "/work/primary");
        assert_eq!(request["params"]["roots"][1]["path"], "/work/shared");
        assert_eq!(request["params"]["metadata"], serde_json::json!({}));
        assert!(
            request["params"]["idempotencyKey"]
                .as_str()
                .unwrap()
                .starts_with("codeagent-")
        );
        let id = &request["id"];
        let project = native_project("project-a", "primary", "/work/primary", 0);
        let response = format!("{{\"id\":{id},\"result\":{{\"project\":{project}}}}}\n");
        server_writer.write_all(response.as_bytes()).await.unwrap();
    });

    let response = add_project(
        &connection,
        vec!["/work/primary".into(), "/work/shared".into()],
    )
    .await
    .expect("project should be created");
    assert_eq!(response.project.id, "project-a");
    server_task.await.unwrap();
}

#[tokio::test]
async fn project_mutations_should_use_native_project_methods() {
    let (client, server) = duplex(16 * 1024);
    let (client_reader, client_writer) = split(client);
    let (server_reader, mut server_writer) = split(server);
    let connection = AppServerConnection::new(client_reader, client_writer);

    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_reader).lines();
        let rename: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(rename["method"], "project/update");
        assert_eq!(
            rename["params"],
            serde_json::json!({"projectId":"project-a","name":"Renamed"})
        );
        let rename_id = &rename["id"];
        let project = native_project("project-a", "Renamed", "/work/a", 0);
        server_writer
            .write_all(
                format!("{{\"id\":{rename_id},\"result\":{{\"project\":{project}}}}}\n").as_bytes(),
            )
            .await
            .unwrap();

        let remove: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(remove["method"], "project/delete");
        assert_eq!(remove["params"]["projectId"], "project-a");
        server_writer
            .write_all(format!("{{\"id\":{},\"result\":{{}}}}\n", remove["id"]).as_bytes())
            .await
            .unwrap();

        for (project_id, before_project_id) in [
            ("project-c", Value::Null),
            ("project-b", Value::String("project-c".into())),
            ("project-a", Value::String("project-b".into())),
        ] {
            let movement: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(movement["method"], "project/move");
            assert_eq!(movement["params"]["projectId"], project_id);
            assert_eq!(movement["params"]["beforeProjectId"], before_project_id);
            server_writer
                .write_all(format!("{{\"id\":{},\"result\":{{}}}}\n", movement["id"]).as_bytes())
                .await
                .unwrap();
        }

        let list: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(list["method"], "project/list");
        let data = [
            native_project("project-a", "A", "/work/a", 0),
            native_project("project-b", "B", "/work/b", 1),
            native_project("project-c", "C", "/work/c", 2),
        ]
        .join(",");
        server_writer
            .write_all(
                format!(
                    "{{\"id\":{},\"result\":{{\"data\":[{data}],\"nextCursor\":null}}}}\n",
                    list["id"]
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let renamed = rename_project(&connection, "project-a".into(), "Renamed".into())
        .await
        .unwrap();
    assert_eq!(renamed.project.name, "Renamed");
    let removed = remove_project(&connection, "project-a".into())
        .await
        .unwrap();
    assert_eq!(removed.status, "removed");
    let reordered = reorder_projects(
        &connection,
        vec!["project-a".into(), "project-b".into(), "project-c".into()],
    )
    .await
    .unwrap();
    assert_eq!(reordered.data.len(), 3);
    server_task.await.unwrap();
}
