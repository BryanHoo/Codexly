use super::{
    AppServerConnection, ConnectionError,
    config::{edit, read_config, write_config},
};
use crate::domain::personalization::{MemorySettings, MemorySettingsUpdate};
use serde_json::{Value, json};
use std::time::Duration;

fn memory_settings(config: &Value) -> MemorySettings {
    let flag = |path: &str, default| {
        config
            .pointer(path)
            .and_then(Value::as_bool)
            .unwrap_or(default)
    };
    MemorySettings {
        enabled: flag("/features/memories", false)
            && flag("/memories/generate_memories", true)
            && flag("/memories/use_memories", true),
        allow_external_context: !flag(
            "/memories/disable_on_external_context",
            flag("/memories/no_memories_if_mcp_or_web_search", false),
        ),
    }
}

pub async fn read_memory_settings(
    connection: &AppServerConnection,
) -> Result<MemorySettings, ConnectionError> {
    Ok(memory_settings(&read_config(connection).await?))
}

pub async fn update_memory_settings(
    connection: &AppServerConnection,
    update: MemorySettingsUpdate,
) -> Result<MemorySettings, ConnectionError> {
    let mut edits = Vec::with_capacity(5);
    if let Some(enabled) = update.enabled {
        // 三个配置一起提交，关闭时同时停止后续生成与提示注入。
        for key in [
            "features.memories",
            "memories.generate_memories",
            "memories.use_memories",
        ] {
            edits.push(edit(key, json!(enabled)));
        }
    }
    if let Some(allowed) = update.allow_external_context {
        // 同批移除官方旧别名，避免两个键并存导致配置反序列化失败。
        edits.push(edit(
            "memories.no_memories_if_mcp_or_web_search",
            Value::Null,
        ));
        edits.push(edit(
            "memories.disable_on_external_context",
            json!(!allowed),
        ));
    }
    if !edits.is_empty() {
        write_config(connection, edits).await?;
    }
    read_memory_settings(connection).await
}

pub async fn reset_memories(connection: &AppServerConnection) -> Result<(), ConnectionError> {
    // 交给官方接口同时清理文件与 SQLite 阶段数据，不能只删除目录。
    let _: Value = connection
        .request("memory/reset", &(), Duration::from_secs(60))
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn memory_updates_should_use_official_batch_write_and_reset() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};
        let (client, server) = duplex(8192);
        let (reader, writer) = split(client);
        let connection = AppServerConnection::new(reader, writer);
        let server_task = tokio::spawn(async move {
            let (reader, mut writer) = split(server);
            let mut lines = BufReader::new(reader).lines();
            for method in ["config/batchWrite", "config/read", "memory/reset"] {
                let request: Value =
                    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
                assert_eq!(request["method"], method);
                if method == "config/batchWrite" {
                    assert_eq!(request["params"]["reloadUserConfig"], true);
                    let edits = request["params"]["edits"].as_array().unwrap();
                    assert_eq!(edits.len(), 5);
                    assert!(edits.iter().any(|item| item["keyPath"]
                        == "memories.no_memories_if_mcp_or_web_search"
                        && item["value"].is_null()));
                    for key in [
                        "features.memories",
                        "memories.generate_memories",
                        "memories.use_memories",
                        "memories.disable_on_external_context",
                    ] {
                        assert!(edits.iter().any(|item| item["keyPath"] == key
                            && item["value"] == true
                            && item["mergeStrategy"] == "replace"));
                    }
                }
                let result = if method == "config/read" {
                    json!({"config": {"features": {"memories": true}, "memories": {"disable_on_external_context": true}}})
                } else {
                    json!({})
                };
                let response = json!({"id": request["id"], "result": result});
                writer
                    .write_all(format!("{response}\n").as_bytes())
                    .await
                    .unwrap();
            }
        });
        let updated = update_memory_settings(
            &connection,
            MemorySettingsUpdate {
                enabled: Some(true),
                allow_external_context: Some(false),
            },
        )
        .await
        .unwrap();
        assert!(updated.enabled);
        assert!(!updated.allow_external_context);
        reset_memories(&connection).await.unwrap();
        server_task.await.unwrap();
    }

    #[test]
    fn memory_settings_should_apply_cli_defaults_and_external_context_inversion() {
        let defaults = memory_settings(&json!({}));
        assert!(!defaults.enabled);
        assert!(defaults.allow_external_context);
        let configured = memory_settings(&json!({
            "features": {"memories": true},
            "memories": {"generate_memories": true, "use_memories": true, "disable_on_external_context": true}
        }));
        assert!(configured.enabled);
        assert!(!configured.allow_external_context);
        assert!(
            !memory_settings(
                &json!({"features": {"memories": true}, "memories": {"use_memories": false}})
            )
            .enabled
        );
    }
}
