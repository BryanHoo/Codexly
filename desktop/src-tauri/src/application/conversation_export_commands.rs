use super::error::AppError;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

const MAX_EXPORT_BYTES: usize = 64 * 1_048_576;

fn valid_export(file_name: &str, content: &str) -> bool {
    // 建议名只允许单个 JSON 文件名，不允许前端借此控制保存路径；字节上限与共享导出器一致。
    !file_name.is_empty()
        && file_name.len() <= 255
        && file_name.ends_with(".json")
        && !file_name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        && content.len() <= MAX_EXPORT_BYTES
}

#[tauri::command]
pub async fn save_conversation_export(
    app: AppHandle,
    file_name: String,
    content: String,
) -> Result<Option<String>, AppError> {
    if !valid_export(&file_name, &content) {
        return Err(AppError::FilesystemRequestFailed);
    }
    let (sender, receiver) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(&file_name)
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    // 使用非阻塞 Dialog 回调，取消是正常结果；文件 IO 交给 Tokio，避免阻塞 WebView/UI 线程。
    let Some(selected) = receiver
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    tokio::fs::write(&path, content)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(Some(
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&file_name)
            .to_owned(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_unicode_json_and_rejects_path_or_oversized_input() {
        assert!(valid_export("对话.json", "{\"text\":\"你好 🐈\"}"));
        for name in [
            "../record.json",
            "C:\\record.json",
            "nested/record.json",
            "file.txt",
            "bad\n.json",
        ] {
            assert!(!valid_export(name, "{}"));
        }
        assert!(!valid_export(
            "record.json",
            &"x".repeat(MAX_EXPORT_BYTES + 1)
        ));
    }
}
