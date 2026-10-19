use super::{error::AppError, state::AppState};
use crate::{
    domain::project_terminal::{
        CreateTerminalRequest, DecimalU64, TerminalControlEvent, TerminalError, TerminalMetadata,
        TerminalScope, TerminalSnapshot, decode_scope_id,
    },
    infrastructure::workspace,
};
use tauri::{
    AppHandle, Manager, State, WebviewWindow,
    ipc::{Channel, InvokeBody, Request, Response},
};

fn ensure_main(label: &str) -> Result<(), TerminalError> {
    if label == "main" {
        Ok(())
    } else {
        Err(TerminalError::ScopeMismatch)
    }
}

fn create_input(body: &InvokeBody) -> Result<CreateTerminalRequest, TerminalError> {
    let InvokeBody::Json(value) = body else {
        return Err(TerminalError::StreamInvalid);
    };
    let mut input = value
        .as_object()
        .cloned()
        .ok_or(TerminalError::StreamInvalid)?;
    input.remove("onOutput");
    let request: CreateTerminalRequest = serde_json::from_value(serde_json::Value::Object(input))
        .map_err(|_| TerminalError::StreamInvalid)?;
    if request
        .root_path
        .as_ref()
        .is_some_and(|path| path.len() > 32_768 || path.contains(['\0', '\r', '\n']))
    {
        return Err(TerminalError::RootInvalid);
    }
    Ok(request)
}

#[tauri::command]
pub async fn connect_project_terminals(
    window: WebviewWindow,
    state: State<'_, AppState>,
    on_event: Channel<TerminalControlEvent>,
) -> Result<TerminalSnapshot, AppError> {
    ensure_main(window.label())?;
    if window
        .state::<super::terminal_lifecycle::TerminalLifecycle>()
        .is_closing()
    {
        return Err(TerminalError::OwnerClosing.into());
    }
    let manager = state.terminals.clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || manager.reconnect(on_event))
        .await
        .map_err(|_| TerminalError::CleanupFailed)??;
    window
        .state::<super::terminal_lifecycle::TerminalLifecycle>()
        .bind_generation(&snapshot.generation);
    Ok(snapshot)
}

#[tauri::command]
pub async fn create_project_terminal(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: Request<'_>,
    on_output: Channel<Response>,
) -> Result<TerminalMetadata, AppError> {
    ensure_main(window.label())?;
    if window
        .state::<super::terminal_lifecycle::TerminalLifecycle>()
        .is_closing()
    {
        return Err(TerminalError::OwnerClosing.into());
    }
    let input = create_input(request.body())?;
    if let Some(metadata) = state.terminals.cached_creation(&input, on_output.id())? {
        return Ok(metadata);
    }
    // 在异步项目查询之前预留，项目删除和 owner 关闭都能取消这次创建。
    let reservation = state.terminals.reserve(input.clone(), on_output.id())?;
    #[cfg(feature = "webview-tests")]
    if let Some(root) = super::terminal_probe::fixture_root(&input.project_id, &input.root_id) {
        // WebDriver 可在隐藏的原生窗口执行脚本；交互验收必须先真实显示并聚焦窗口。
        window.show().map_err(|_| TerminalError::SpawnFailed)?;
        window.set_focus().map_err(|_| TerminalError::SpawnFailed)?;
        return tauri::async_runtime::spawn_blocking(move || {
            reservation.spawn_root(&root, on_output)
        })
        .await
        .map_err(|_| TerminalError::SpawnFailed)?
        .map_err(Into::into);
    }
    if let Some(path) = input.root_path.as_deref() {
        // 草稿尚无 taskId，直接沿项目/worktree 归属校验选择目录，不依赖执行引擎。
        let (root, _) =
            super::workspace_commands::project_root(&app, &input.project_id, path).await?;
        return tauri::async_runtime::spawn_blocking(move || {
            reservation.spawn_root(&root, on_output)
        })
        .await
        .map_err(|_| TerminalError::SpawnFailed)?
        .map_err(Into::into);
    }
    if let Some(task_id) = input.root_id.strip_prefix("worktree:") {
        // 与文件、Git 操作使用同一归属校验，客户端不能借终端访问任意目录。
        let task = super::claude_tasks::task(&app, &input.project_id, task_id).await?;
        let path = task["cwd"].as_str().ok_or(TerminalError::RootInvalid)?;
        let (root, _) =
            super::workspace_commands::project_root(&app, &input.project_id, path).await?;
        return tauri::async_runtime::spawn_blocking(move || {
            reservation.spawn_root(&root, on_output)
        })
        .await
        .map_err(|_| TerminalError::SpawnFailed)?
        .map_err(Into::into);
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| TerminalError::ProjectNotFound)?;
    let catalog = crate::infrastructure::local_catalog::LocalCatalog::at(&directory)?;
    let project = crate::infrastructure::local_catalog::sidebar::map_project(
        &catalog
            .call("project.read", serde_json::json!({"id": input.project_id}))
            .await?,
    )?;
    let root = project
        .roots
        .into_iter()
        .find(|root| root.id == input.root_id)
        .ok_or(TerminalError::RootInvalid)?;
    let root = workspace::canonical_root(&root.path)
        .await
        .map_err(|_| TerminalError::RootInvalid)?;
    tauri::async_runtime::spawn_blocking(move || reservation.spawn_root(&root, on_output))
        .await
        .map_err(|_| TerminalError::SpawnFailed)?
        .map_err(Into::into)
}

#[tauri::command]
pub fn write_project_terminal(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: Request<'_>,
) -> Result<(), AppError> {
    ensure_main(window.label())?;
    let header = |name| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or(TerminalError::ScopeMismatch)
    };
    let scope = TerminalScope {
        project_id: decode_scope_id(header("x-codeagent-project-id")?)?,
        terminal_id: decode_scope_id(header("x-codeagent-terminal-id")?)?,
        generation: decode_scope_id(header("x-codeagent-generation")?)?,
    };
    let sequence: DecimalU64 = header("x-codeagent-input-sequence")?.parse()?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(TerminalError::StreamInvalid.into());
    };
    state
        .terminals
        .write(&scope, sequence.0, bytes)
        .map_err(Into::into)
}

#[tauri::command]
pub fn ack_project_terminal(
    window: WebviewWindow,
    state: State<'_, AppState>,
    project_id: String,
    terminal_id: String,
    generation: String,
    parsed_offset: DecimalU64,
) -> Result<(), AppError> {
    ensure_main(window.label())?;
    state
        .terminals
        .ack(
            &TerminalScope {
                project_id,
                terminal_id,
                generation,
            },
            parsed_offset.0,
        )
        .map_err(Into::into)
}

#[tauri::command]
pub async fn resize_project_terminal(
    window: WebviewWindow,
    state: State<'_, AppState>,
    project_id: String,
    terminal_id: String,
    generation: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    ensure_main(window.label())?;
    let manager = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.resize(
            &TerminalScope {
                project_id,
                terminal_id,
                generation,
            },
            cols,
            rows,
        )
    })
    .await
    .map_err(|_| TerminalError::StreamInvalid)?
    .map_err(Into::into)
}

#[tauri::command]
pub async fn close_project_terminal(
    window: WebviewWindow,
    state: State<'_, AppState>,
    project_id: String,
    terminal_id: String,
    generation: String,
) -> Result<(), AppError> {
    ensure_main(window.label())?;
    let manager = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.close(&TerminalScope {
            project_id,
            terminal_id,
            generation,
        })
    })
    .await
    .map_err(|_| TerminalError::CleanupFailed)?
    .map_err(Into::into)
}

#[tauri::command]
pub fn remove_project_terminal(
    window: WebviewWindow,
    state: State<'_, AppState>,
    project_id: String,
    terminal_id: String,
    generation: String,
) -> Result<(), AppError> {
    ensure_main(window.label())?;
    state
        .terminals
        .remove(&TerminalScope {
            project_id,
            terminal_id,
            generation,
        })
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_authority_is_not_granted_by_a_caller_generation() {
        assert!(ensure_main("main").is_ok());
        for label in ["desktop-pet", "project-file", "", "MAIN"] {
            assert_eq!(ensure_main(label), Err(TerminalError::ScopeMismatch));
        }
    }
    #[test]
    fn creation_rejects_arbitrary_shell_and_directory_fields() {
        let mut value = serde_json::json!({"projectId":"p", "rootId":"r", "requestId":"q", "generation":"g", "cols":80, "rows":24, "onOutput":"__CHANNEL__:1"});
        assert!(create_input(&InvokeBody::Json(value.clone())).is_ok());
        value["cwd"] = serde_json::json!("/tmp");
        assert!(create_input(&InvokeBody::Json(value)).is_err());
    }
}
