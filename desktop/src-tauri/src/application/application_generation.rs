use super::{error::AppError, state::AppState};
use crate::infrastructure::{app_data, local_catalog::LocalCatalog};
use serde_json::{Value, json};
use std::path::Path;
use tauri::AppHandle;

/// 旧调用省略运行时标记；未知标记不能悄悄回退到旧 SDK。
pub(super) fn is_acp(runtime: Option<&str>, request_id: Option<&str>) -> Result<bool, AppError> {
    if request_id.is_some_and(|id| id.is_empty() || id.len() > 256) {
        return Err(AppError::Acp(
            "Invalid generation cancellation request".into(),
        ));
    }
    match runtime {
        None => Ok(false),
        Some("acp") => Ok(true),
        Some(_) => Err(AppError::Acp("Unsupported application runtime".into())),
    }
}

async fn prepare(
    directory: &Path,
    project_id: &str,
    root: &Path,
    purpose: &str,
    text: &str,
) -> Result<(Value, Value), AppError> {
    let limit = match purpose {
        "title" | "optimize" => 32_000,
        "commit" => 524_288,
        _ => return Err(AppError::Acp("Invalid generation purpose".into())),
    };
    if project_id.is_empty()
        || !root.is_absolute()
        || text.trim().is_empty()
        || text.encode_utf16().take(limit + 1).count() > limit
    {
        return Err(AppError::Acp(
            "Invalid application generation request".into(),
        ));
    }
    let catalog = LocalCatalog::at(directory)?;
    let preferences = super::application_preferences_commands::read(&catalog, directory).await?;
    let scope = json!({"id":project_id,"kind":if project_id=="temporary" {"temporary"}else{"project"},"rootPath":root,"runtimeWorkspaceRoots":[root]});
    Ok((
        scope,
        json!({"preferences":preferences,"request":{"purpose":purpose,"text":text}}),
    ))
}

/// root 必须已由项目 / Git 用例授权；偏好只从可信应用目录读取，不能接受前端副本。
pub(super) async fn generate(
    app: &AppHandle,
    state: &AppState,
    project_id: &str,
    root: &Path,
    purpose: &str,
    text: &str,
) -> Result<String, AppError> {
    let directory = app_data::directory(app).map_err(|_| AppError::FilesystemRequestFailed)?;
    let (scope, params) = prepare(&directory, project_id, root, purpose, text).await?;
    let result = state
        .acp
        .host
        .request(app, "application.generate", Some(scope), params)
        .await?;
    result
        .as_str()
        .filter(|text| {
            !text.trim().is_empty() && text.encode_utf16().take(10_001).count() <= 10_000
        })
        .map(str::to_owned)
        .ok_or_else(|| AppError::Acp("Invalid application generation output".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[tokio::test]
    async fn preparation_should_read_private_preferences_without_modifying_legacy_files() {
        let directory = tempfile::tempdir().unwrap();
        let legacy =
            br#"{"version":1,"global":{"defaultAgent":"codex","defaultModel":"old-model"}}"#;
        std::fs::write(directory.path().join("agent-settings.json"), legacy).unwrap();
        let catalog =
            crate::infrastructure::local_catalog::LocalCatalog::at(directory.path()).unwrap();
        let baseline = crate::infrastructure::local_catalog::application_preferences::contract()
            .unwrap()["defaults"]
            .clone();
        catalog.call("app.preferences.patch",json!({"baseline":baseline,"changes":{"defaultAgent":"claude","defaultModel":null,"promptOptimizationPrompt":"私有规则"}})).await.unwrap();
        let (scope, params) = prepare(directory.path(), "p", directory.path(), "optimize", "输入")
            .await
            .unwrap();
        assert_eq!(scope["rootPath"], directory.path().to_str().unwrap());
        assert_eq!(params["preferences"]["defaultAgent"], "claude");
        assert_eq!(
            params["preferences"]["defaultModel"],
            serde_json::Value::Null
        );
        assert_eq!(
            params["preferences"]["promptOptimizationPrompt"],
            "私有规则"
        );
        assert_eq!(
            params["request"],
            json!({"purpose":"optimize","text":"输入"})
        );
        assert_eq!(
            std::fs::read(directory.path().join("agent-settings.json")).unwrap(),
            legacy
        );
    }
}
