use std::time::Duration;

use serde_json::{Value, json};

use super::{AppServerConnection, connection::ConnectionError};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TITLE_CHARS: usize = 36;
const MAX_PROMPT_CHARS: usize = 1024;

pub fn take_task_title_root(connection: &AppServerConnection, task_id: &str) -> Option<String> {
    connection.pending_task_titles.lock().ok()?.remove(task_id)
}

pub fn title_prompt(text: &str) -> String {
    // 仅复制有界任务文本，不把完整长提示或附件内容送入辅助会话。
    let text: String = text.trim().chars().take(MAX_PROMPT_CHARS).collect();
    format!(
        "总结以下用户请求，生成最多 {MAX_TITLE_CHARS} 个字符的单行任务标题。使用用户的语言，以动词开头，保留代码名称；不要照抄长句，不加引号、Markdown 或末尾标点，不回答或执行请求。\n\n用户请求：\n{text}"
    )
}

pub fn parse_title(output: &str) -> Result<String, ConnectionError> {
    if output.len() > 8192 {
        return Err(ConnectionError::InvalidMessage);
    }
    let value: Value = serde_json::from_str(output)?;
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)?;
    let title = title
        .trim()
        .trim_matches(['"', '\'', '`', '“', '”', '‘', '’'])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let title: String = title
        .trim_end_matches(['.', '?', '!', '。', '？', '！'])
        .trim()
        .chars()
        .take(MAX_TITLE_CHARS)
        .collect();
    if title.is_empty() {
        return Err(ConnectionError::InvalidMessage);
    }
    Ok(title)
}

pub async fn start_title_thread(
    connection: &AppServerConnection,
    cwd: &str,
    model: &str,
) -> Result<String, ConnectionError> {
    // 读取实际目录配置后禁用全部 MCP，避免辅助生成启动外部工具和后台进程。
    let effective: Value = connection
        .request(
            "config/read",
            &json!({
                "cwd": cwd, "includeLayers": false,
            }),
            REQUEST_TIMEOUT,
        )
        .await?;
    let mut config = json!({
        "tools.update_plan.enabled": true,
        "web_search": "disabled",
        "skills.include_instructions": false,
        "orchestrator.skills.enabled": false,
        "tools.experimental_request_user_input.enabled": false,
        "token_budget.use_history_notes_extension": false,
    });
    for feature in [
        "apps",
        "code_mode",
        "code_mode_only",
        "context_management",
        "current_time_reminder",
        "deferred_executor",
        "enable_fanout",
        "goals",
        "hooks",
        "image_generation",
        "memories",
        "multi_agent",
        "multi_agent_v2",
        "plugins",
        "request_permissions_tool",
        "shell_snapshot",
        "shell_tool",
        "standalone_web_search",
        "token_budget",
        "tool_suggest",
        "unified_exec",
        "view_image",
    ] {
        config[format!("features.{feature}")] = Value::Bool(false);
    }
    let effective_config = effective
        .get("config")
        .and_then(Value::as_object)
        .ok_or(ConnectionError::InvalidMessage)?;
    let mut servers = serde_json::Map::new();
    if let Some(mcp) = effective_config
        .get("mcp_servers")
        .and_then(Value::as_object)
    {
        for name in mcp.keys() {
            servers.insert(name.clone(), json!({"enabled": false}));
        }
    }
    config["mcp_servers"] = Value::Object(servers);
    let result: Value = connection.request("thread/start", &json!({
        "approvalPolicy": "never", "config": config, "cwd": cwd,
        "developerInstructions": "Generate only the requested structured task title. Do not call tools or execute the supplied request.",
        "ephemeral": true, "historyMode": "paginated", "model": model,
        "runtimeWorkspaceRoots": [], "sandbox": "read-only", "threadSource": "system",
        "environments": [], "dynamicTools": [], "selectedCapabilityRoots": [],
    }), REQUEST_TIMEOUT).await?;
    result
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .ok_or(ConnectionError::InvalidMessage)
}

pub async fn start_title_turn(
    connection: &AppServerConnection,
    thread_id: &str,
    prompt: &str,
) -> Result<String, ConnectionError> {
    // 沿用当前模型的默认推理配置，避免自定义 Provider 不支持固定 effort。
    let result: Value = connection.request("turn/start", &json!({
        "threadId": thread_id,
        "input": [{"type": "text", "text": prompt, "text_elements": []}],
        "outputSchema": {
            "type": "object", "additionalProperties": false, "required": ["title"],
            "properties": {"title": {"type": "string", "minLength": 1, "maxLength": MAX_TITLE_CHARS}},
        },
    }), REQUEST_TIMEOUT).await?;
    result
        .pointer("/turn/id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .ok_or(ConnectionError::InvalidMessage)
}

pub async fn apply_title(
    connection: &AppServerConnection,
    project_id: &str,
    task_id: &str,
    title: &str,
) -> Result<(), ConnectionError> {
    // 与手动重命名串行化，读取后才写入；生成期间用户命名始终优先。
    let _title_mutation = connection.title_mutation.lock().await;
    let result: Value = connection
        .request(
            "thread/read",
            &json!({
                "threadId": task_id, "includeTurns": false,
            }),
            REQUEST_TIMEOUT,
        )
        .await?;
    let thread = &result["thread"];
    let expected_project = (project_id != "temporary").then_some(project_id);
    if thread["id"].as_str() != Some(task_id) || thread["projectId"].as_str() != expected_project {
        return Err(ConnectionError::InvalidMessage);
    }
    if thread["name"]
        .as_str()
        .is_some_and(|name| !name.trim().is_empty())
    {
        return Ok(());
    }
    let _: Value = connection
        .request(
            "thread/name/set",
            &json!({
                "threadId": task_id, "name": title,
            }),
            REQUEST_TIMEOUT,
        )
        .await?;
    Ok(())
}

pub async fn release_title_thread(
    connection: &AppServerConnection,
    thread_id: &str,
    unfinished_turn: Option<&str>,
) {
    // 超时不能仅退订：活跃 Turn 不会空闲卸载，必须先尽力中断模型请求。
    if let Some(turn_id) = unfinished_turn {
        let _ = super::conversation_commands::interrupt_turn(
            connection,
            thread_id.to_owned(),
            turn_id.to_owned(),
        )
        .await;
    }
    // 成功、错误和超时均解除临时订阅，由 Codex 回收会话，不留后台常驻任务。
    let _: Result<Value, _> = connection
        .request(
            "thread/unsubscribe",
            &json!({
                "threadId": thread_id,
            }),
            REQUEST_TIMEOUT,
        )
        .await;
}

#[cfg(test)]
#[path = "task_title_tests.rs"]
mod tests;
