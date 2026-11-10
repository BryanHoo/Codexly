use super::{claude_host::ClaudeHostManager, error::AppError, state::AppState};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

pub struct AcpDesktopRuntime {
    pub(super) host: ClaudeHostManager,
}
impl Default for AcpDesktopRuntime {
    fn default() -> Self {
        Self {
            host: ClaudeHostManager::for_acp(),
        }
    }
}
impl AcpDesktopRuntime {
    pub async fn close(&self) {
        self.host.close().await;
    }
}

/// 只读能力入口不接收工作目录或程序路径；认证与配置写入使用后续独立命令。
#[tauri::command]
pub async fn read_acp_agent(app: AppHandle, engine: String) -> Result<Value, AppError> {
    if !matches!(engine.as_str(), "codex" | "claude") {
        return Err(AppError::Acp("Invalid ACP engine".into()));
    }
    app.state::<AppState>()
        .acp
        .host
        .request(&app, "agent.inspect", None, json!({"engine":engine}))
        .await
}

fn settings_params(engine: &str, method: &str, params: Value) -> Result<Value, AppError> {
    if !matches!(engine, "codex" | "claude")
        || !matches!(
            method,
            "agent.inspect"
                | "agent.authenticate"
                | "settings.read"
                | "settings.write"
                | "providers.list"
                | "providers.set"
                | "providers.disable"
        )
    {
        return Err(AppError::Acp("Unsupported ACP settings operation".into()));
    }
    let Value::Object(mut params) = params else {
        return Err(AppError::Acp("Invalid ACP parameters".into()));
    };
    if params.contains_key("engine") {
        return Err(AppError::Acp("ACP engine cannot be overridden".into()));
    }
    params.insert("engine".into(), json!(engine));
    Ok(Value::Object(params))
}

/// 全局设置白名单复用共享宿主 Schema；不允许项目方法、路径或动态成员调用。
#[tauri::command(rename_all = "camelCase")]
pub async fn acp_agent_request(
    app: AppHandle,
    engine: String,
    method: String,
    params: Value,
    request_id: Option<String>,
) -> Result<Value, AppError> {
    let params = settings_params(&engine, &method, params)?;
    let cancellable = super::claude_host::cancellable_acp_request(&method);
    if request_id
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 256)
        || (!cancellable && request_id.is_some())
    {
        return Err(AppError::Acp("Invalid ACP cancellation request".into()));
    }
    let state = app.state::<AppState>();
    let operation = state.acp.host.request(&app, &method, None, params);
    if cancellable {
        state
            .run_cancellable(request_id.as_deref(), operation)
            .await
    } else {
        // 写入等待失败意味着结果可能不确定，不能在此转为安全重试或伪造未提交。
        operation.await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn acp_settings_should_reject_method_or_engine_injection() {
        assert!(settings_params("codex", "close", json!({})).is_err());
        assert!(settings_params("unknown", "settings.read", json!({})).is_err());
        assert!(
            settings_params(
                "codex",
                "settings.write",
                json!({"engine":"claude","values":{}})
            )
            .is_err()
        );
        let values = json!({"values":{"model":"m","enabled":false}});
        let result = settings_params("claude", "settings.write", values).unwrap();
        assert_eq!(result["engine"], "claude");
        assert_eq!(result["values"]["enabled"], false);
    }
}
