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
                | "settings.preview"
                | "settings.read"
                | "settings.write"
                | "settings.config.write"
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
    if method == "settings.preview"
        && (!params
            .get("projectId")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.is_empty())
            || params.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "projectId" | "values" | "change" | "workspacePath"
                )
            })
            || params.get("workspacePath").is_some_and(|path| {
                !path.as_str().is_some_and(|path| {
                    !path.is_empty()
                        && path.encode_utf16().take(32769).count() <= 32768
                        && !path.contains(['\0', '\r', '\n'])
                        && std::path::Path::new(path).is_absolute()
                })
            }))
    {
        return Err(AppError::Acp("Invalid ACP preview parameters".into()));
    }
    params.insert("engine".into(), json!(engine));
    Ok(Value::Object(params))
}

async fn preview_scope(
    directory: &std::path::Path,
    project_id: &str,
    workspace_path: Option<&str>,
) -> Result<Value, AppError> {
    let root = if project_id == "temporary" {
        if workspace_path.is_some() {
            return Err(AppError::Acp(
                "Temporary preview workspace cannot be overridden".into(),
            ));
        }
        crate::infrastructure::temporary_workspace_settings::read_root(directory)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?
    } else {
        let catalog = crate::infrastructure::local_catalog::LocalCatalog::at(directory)?;
        let project = catalog
            .call("project.read", json!({"id":project_id}))
            .await?;
        let path = workspace_path
            .or_else(|| project["path"].as_str())
            .ok_or(AppError::FilesystemRequestFailed)?;
        super::workspace_commands::project_root_from_catalog(&catalog, project_id, path)
            .await?
            .0
    };
    let root = root.to_string_lossy();
    Ok(
        json!({"id":project_id,"kind":if project_id=="temporary"{"temporary"}else{"project"},"rootPath":root,"runtimeWorkspaceRoots":[root]}),
    )
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
    let mut params = settings_params(&engine, &method, params)?;
    let cancellable = super::claude_host::cancellable_acp_request(&method);
    if request_id
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 256)
        || (!cancellable && request_id.is_some())
    {
        return Err(AppError::Acp("Invalid ACP cancellation request".into()));
    }
    let state = app.state::<AppState>();
    let operation = async {
        let scope = if method == "settings.preview" {
            let project_id = params
                .as_object_mut()
                .and_then(|values| values.remove("projectId"))
                .and_then(|value| value.as_str().map(str::to_owned))
                .filter(|id| !id.is_empty())
                .ok_or_else(|| AppError::Acp("Invalid preview project".into()))?;
            let directory = crate::infrastructure::app_data::directory(&app)
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            let workspace_path = params
                .as_object_mut()
                .and_then(|values| values.remove("workspacePath"));
            // 根目录与 Git 工作树授权复用本地用例；客户端目录字段不直接进入宿主。
            Some(
                preview_scope(
                    &directory,
                    &project_id,
                    workspace_path.as_ref().and_then(Value::as_str),
                )
                .await?,
            )
        } else {
            None
        };
        state.acp.host.request(&app, &method, scope, params).await
    };
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
    #[tokio::test]
    async fn preview_should_use_authorized_project_workspace_without_an_engine() {
        let directory = tempfile::tempdir().unwrap();
        let project_root = directory.path().join("project");
        let outside = directory.path().join("outside");
        std::fs::create_dir(&project_root).unwrap();
        std::fs::create_dir(&outside).unwrap();
        let catalog =
            crate::infrastructure::local_catalog::LocalCatalog::at(&directory.path().join("data"))
                .unwrap();
        let project = catalog
            .add_project(vec![project_root.to_str().unwrap().into()])
            .await
            .unwrap();
        let scope = preview_scope(
            &directory.path().join("data"),
            &project.id,
            Some(project_root.to_str().unwrap()),
        )
        .await
        .unwrap();
        assert_eq!(
            scope["rootPath"].as_str().unwrap(),
            std::fs::canonicalize(&project_root)
                .unwrap()
                .to_str()
                .unwrap()
        );
        assert!(
            preview_scope(
                &directory.path().join("data"),
                &project.id,
                Some(outside.to_str().unwrap())
            )
            .await
            .is_err()
        );
        assert!(
            preview_scope(
                directory.path(),
                "temporary",
                Some(project_root.to_str().unwrap())
            )
            .await
            .is_err()
        );
    }
    #[test]
    fn preview_should_require_project_and_reject_directory_injection() {
        let prefix = if cfg!(windows) { "C:\\" } else { "/" };
        let allowed = format!("{prefix}{}", "中".repeat(16000));
        let oversized = format!("{prefix}{}", "中".repeat(32768));
        assert!(
            settings_params(
                "claude",
                "settings.preview",
                json!({"projectId":"p","values":{},"workspacePath":allowed})
            )
            .is_ok()
        );
        assert!(
            settings_params(
                "claude",
                "settings.preview",
                json!({"projectId":"p","values":{},"workspacePath":oversized})
            )
            .is_err()
        );
        assert!(
            settings_params(
                "claude",
                "settings.preview",
                json!({"projectId":"p","values":{"enabled":false}})
            )
            .is_ok()
        );
        assert!(settings_params("claude", "settings.preview", json!({"values":{}})).is_err());
        assert!(
            settings_params(
                "claude",
                "settings.preview",
                json!({"projectId":"p","values":{},"cwd":"/secret"})
            )
            .is_err()
        );
    }
    #[test]
    fn acp_settings_should_reject_method_or_engine_injection() {
        assert!(settings_params("codex", "close", json!({})).is_err());
        assert!(
            settings_params(
                "codex",
                "settings.config.write",
                json!({"configId":"x","value":false})
            )
            .is_ok()
        );
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
