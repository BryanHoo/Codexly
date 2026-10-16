use crate::application::{error::AppError, state::AppState};
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
#[cfg(not(target_os = "windows"))]
use sha2::{Digest, Sha256};
#[cfg(not(target_os = "windows"))]
use std::path::{Path, PathBuf};
use std::{
    collections::HashMap,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex, oneshot},
};

const MAX_FRAME: usize = 8 * 1024 * 1024;
pub fn normalize_item(item: &mut Value) {
    if item["type"] == "reasoning" {
        let text = item["content"].as_str().unwrap_or_default().to_owned();
        let id = item["id"].clone();
        *item = json!({"id":id,"type":"reasoning","text":text});
    }
}
pub fn normalize_event(event: &mut Value) {
    if event["type"] == "reasoning.delta" {
        event["payload"] = json!({"delta":event["payload"]["delta"]});
    }
    if let Some(item) = event.pointer_mut("/payload/item") {
        normalize_item(item);
    }
    if let Some(items) = event
        .pointer_mut("/payload/turn/items")
        .and_then(Value::as_array_mut)
    {
        for item in items {
            normalize_item(item);
        }
    }
}
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

#[derive(Default)]
pub struct ClaudeHostManager {
    host: Mutex<Option<Arc<ClaudeHost>>>,
}
struct ClaudeHost {
    child: Mutex<Child>,
    writer: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    next_id: AtomicU64,
}

impl ClaudeHostManager {
    pub async fn request(
        &self,
        app: &AppHandle,
        method: &str,
        scope: Option<Value>,
        params: Value,
    ) -> Result<Value, AppError> {
        let host = {
            let mut current = self.host.lock().await;
            let alive = if let Some(host) = current.as_ref() {
                host.child
                    .lock()
                    .await
                    .try_wait()
                    .map_err(failure)?
                    .is_none()
            } else {
                false
            };
            if !alive {
                *current = Some(Arc::new(ClaudeHost::start(app).await?));
            }
            Arc::clone(
                current
                    .as_ref()
                    .ok_or_else(|| failure("Claude host unavailable"))?,
            )
        };
        host.request(method, scope, params).await
    }

    pub async fn close(&self) {
        if let Some(host) = self.host.lock().await.take() {
            let _ = host.writer.lock().await.shutdown().await;
            let mut child = host.child.lock().await;
            if tokio::time::timeout(Duration::from_secs(3), child.wait())
                .await
                .is_err()
            {
                let _ = child.kill().await;
            }
        }
    }
}

fn failure(error: impl std::fmt::Display) -> AppError {
    AppError::Claude(error.to_string())
}

impl ClaudeHost {
    async fn start(app: &AppHandle) -> Result<Self, AppError> {
        let app_data = app.path().app_data_dir().map_err(failure)?;
        #[cfg(target_os = "windows")]
        let (binary, host_path) = super::claude_embedded_assets::prepare(&app_data).await?;
        #[cfg(not(target_os = "windows"))]
        let (binary, host_path) = {
            let resources = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/claude")
            } else {
                app.path().resource_dir().map_err(failure)?.join("claude")
            };
            let binary = prepare_binary(&resources, &app_data).await?;
            let host_path = resources.join(if cfg!(windows) {
                "claude-host.exe"
            } else {
                "claude-host"
            });
            (binary, host_path)
        };
        let mut command = Command::new(host_path);
        command
            .arg(app_data.join("engines/claude"))
            .arg(binary)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let mut child = command.spawn().map_err(failure)?;
        let writer = Arc::new(Mutex::new(
            child
                .stdin
                .take()
                .ok_or_else(|| failure("Claude host stdin unavailable"))?,
        ));
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| failure("Claude host stdout unavailable"))?;
        let pending: Pending = Arc::default();
        let catalog = LocalCatalog::at(&app_data)?;
        let app = app.clone();
        let response_writer = Arc::clone(&writer);
        let responses = Arc::clone(&pending);
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = Vec::new();
            let mut active_turns: HashMap<String, (String, String)> = HashMap::new();
            loop {
                line.clear();
                // 在分配正文前限制每帧，避免异常子进程输出导致原生层无界缓冲。
                match (&mut reader)
                    .take((MAX_FRAME + 1) as u64)
                    .read_until(b'\n', &mut line)
                    .await
                {
                    Ok(0) | Err(_) => break,
                    Ok(_) if line.len() > MAX_FRAME => break,
                    Ok(_) => {}
                }
                let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                    break;
                };
                if let Some(id) = message["id"].as_u64() {
                    if let Some(sender) = responses.lock().await.remove(&id) {
                        let result = message["error"].as_str().map_or_else(
                            || Ok(message["result"].clone()),
                            |error| Err(error.to_owned()),
                        );
                        let _ = sender.send(result);
                    }
                } else if let Some(id) = message["catalogId"].as_u64() {
                    let result = match message["operation"].as_str() {
                        Some(
                            operation @ ("task.read" | "task.put" | "task.patch" | "task.list"
                            | "task.remove"),
                        ) => catalog
                            .call(operation, message["payload"].clone())
                            .await
                            .map_err(|error| error.to_string()),
                        _ => Err("Unsupported Claude catalog operation".to_owned()),
                    };
                    let frame = match result {
                        Ok(result) => json!({"catalogId":id,"result":result}),
                        Err(error) => json!({"catalogId":id,"error":error}),
                    };
                    if write_frame(&response_writer, &frame).await.is_err() {
                        break;
                    }
                } else if message["event"].is_object() {
                    let project = message["projectId"].as_str().unwrap_or_default();
                    let event = &message["event"];
                    if let (Some(task), Some(turn)) =
                        (event["taskId"].as_str(), event["turnId"].as_str())
                    {
                        if event["type"] == "turn.started" {
                            active_turns
                                .insert(task.to_owned(), (project.to_owned(), turn.to_owned()));
                        }
                        if event["type"] == "turn.completed" {
                            active_turns.remove(task);
                        }
                    }
                    app.state::<AppState>()
                        .publish_claude_event(&app, project, message["event"].clone())
                        .await;
                }
            }
            for (task, (project, turn)) in active_turns {
                app.state::<AppState>().publish_claude_event(&app, &project, json!({"type":"provider.error","taskId":task,"turnId":turn,"payload":{"message":"Claude host connection closed","willRetry":false}})).await;
                let _ = catalog
                    .call("task.patch", json!({"id":task,"status":"failed"}))
                    .await;
            }
            for (_, sender) in responses.lock().await.drain() {
                let _ = sender.send(Err("Claude host connection closed".to_owned()));
            }
        });
        Ok(Self {
            child: Mutex::new(child),
            writer,
            pending,
            next_id: AtomicU64::new(1),
        })
    }

    async fn request(
        &self,
        method: &str,
        scope: Option<Value>,
        params: Value,
    ) -> Result<Value, AppError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            if pending.len() >= 32 {
                return Err(failure("Claude request capacity exceeded"));
            }
            pending.insert(id, sender);
        }
        let result = async {
            write_frame(
                &self.writer,
                &json!({"id":id,"method":method,"scope":scope,"params":params}),
            )
            .await?;
            tokio::time::timeout(Duration::from_secs(45), receiver)
                .await
                .map_err(failure)?
                .map_err(failure)?
                .map_err(failure)
        }
        .await;
        self.pending.lock().await.remove(&id);
        result
    }
}

async fn write_frame(writer: &Mutex<ChildStdin>, value: &Value) -> Result<(), AppError> {
    let mut bytes = serde_json::to_vec(value).map_err(failure)?;
    if bytes.len() > MAX_FRAME {
        return Err(failure("Claude request exceeds transport budget"));
    }
    bytes.push(b'\n');
    writer.lock().await.write_all(&bytes).await.map_err(failure)
}

#[cfg(not(target_os = "windows"))]
async fn prepare_binary(resources: &Path, app_data: &Path) -> Result<PathBuf, AppError> {
    let manifest: Value = serde_json::from_slice(
        &tokio::fs::read(resources.join("manifest.json"))
            .await
            .map_err(failure)?,
    )
    .map_err(failure)?;
    if manifest["sdkVersion"] != "0.3.300" {
        return Err(failure("Incompatible Claude SDK runtime"));
    }
    let name = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };
    let target_dir = app_data.join("providers/claude/0.3.300");
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(failure)?;
    let target = target_dir.join(name);
    let source = resources.join(name);
    let expected = manifest["sha256"]
        .as_str()
        .ok_or_else(|| failure("Missing Claude runtime integrity"))?
        .to_owned();
    let output = target.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::{Read, Write};
        let hash = |path: &Path| -> Result<String, std::io::Error> {
            let mut file = std::fs::File::open(path)?;
            let mut digest = Sha256::new();
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let count = file.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                digest.update(&buffer[..count]);
            }
            Ok(digest
                .finalize()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect())
        };
        if hash(&target).ok().as_deref() == Some(&expected) {
            return Ok(());
        }
        if hash(&source).map_err(|error| error.to_string())? != expected {
            return Err("Claude runtime integrity mismatch".to_owned());
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(&target_dir).map_err(|error| error.to_string())?;
        let mut file = std::fs::File::open(source).map_err(|error| error.to_string())?;
        std::io::copy(&mut file, &mut temporary).map_err(|error| error.to_string())?;
        temporary.flush().map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .as_file()
                .set_permissions(std::fs::Permissions::from_mode(0o755))
                .map_err(|error| error.to_string())?;
        }
        temporary
            .persist(&target)
            .map_err(|error| error.to_string())?;
        Ok(())
    })
    .await
    .map_err(failure)?
    .map_err(failure)?;
    Ok(output)
}
