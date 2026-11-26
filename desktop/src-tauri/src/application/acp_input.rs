use super::error::AppError;
use crate::domain::conversation::AgentPromptInput;
use serde_json::{Value, json};
use std::path::Path;
use tokio::io::AsyncReadExt;

/// 上传引用复用应用授权器；历史引用单独交由 ACP 宿主按任务读取，不能作为本机路径使用。
pub(super) async fn prepare(
    directory: &Path,
    project: &str,
    task: &str,
    value: Value,
) -> Result<(AgentPromptInput, Vec<String>), AppError> {
    let mut input: AgentPromptInput =
        serde_json::from_value(value).map_err(|_| AppError::FilesystemRequestFailed)?;
    if !input.skills.is_empty() || input.attachments.len() > 1500 {
        return Err(AppError::FilesystemRequestFailed);
    }
    let mut references = Vec::new();
    let mut uploads = Vec::new();
    for attachment in std::mem::take(&mut input.attachments) {
        let id = attachment["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 32768)
            .ok_or(AppError::FilesystemRequestFailed)?;
        if Path::new(id).is_absolute() {
            uploads.push(attachment);
        } else {
            references.push(id.to_owned());
        }
    }
    input.attachments = uploads;
    super::attachment_commands::resolve_prompt_attachments(directory, project, task, &mut input)
        .await?;
    Ok((input, references))
}

/// 此函数只消费已授权上传 / 已验证导出；文本定长读取，路径不来自任意前端字段。
pub(super) async fn provider_input(input: AgentPromptInput) -> Result<Value, AppError> {
    let mut images = Vec::new();
    let mut files = Vec::new();
    let mut texts = Vec::new();
    let mut text_bytes = 0;
    for a in input.attachments {
        let path = a["id"].as_str().ok_or(AppError::FilesystemRequestFailed)?;
        match a["kind"].as_str() {
            Some("image")=>images.push(json!({"path":path,"mediaType":a["mediaType"],"detail":a["detail"].as_str().unwrap_or("auto")})),
            Some("text")=>{
                let mut bytes=Vec::new();
                tokio::fs::File::open(path).await.map_err(|_|AppError::FilesystemRequestFailed)?.take(1024*1024+1).read_to_end(&mut bytes).await.map_err(|_|AppError::FilesystemRequestFailed)?;
                text_bytes+=bytes.len();
                if text_bytes>1024*1024 {return Err(AppError::FilesystemRequestFailed);}
                let text=String::from_utf8(bytes).map_err(|_|AppError::FilesystemRequestFailed)?;
                texts.push(json!({"name":a["name"],"text":text}));
            }
            Some("file")=>files.push(json!({"path":path,"name":a["name"],"mediaType":a["mediaType"]})),
            _=>return Err(AppError::FilesystemRequestFailed),
        }
    }
    Ok(json!({"text":input.text,"skills":[],"files":files,"images":images,"textAttachments":texts}))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    #[tokio::test]
    async fn authorized_upload_should_preserve_text_and_reject_other_projects() {
        let root = tempfile::tempdir().unwrap();
        let uploaded = crate::infrastructure::workspace::store_attachment(
            root.path(),
            "p",
            "text",
            "a.txt",
            b"proof",
        )
        .await
        .unwrap();
        let attachment = serde_json::to_value(uploaded).unwrap()["attachment"].clone();
        let input = json!({"text":"question","attachments":[attachment],"skills":[]});
        assert!(
            super::prepare(root.path(), "other", "t", input.clone())
                .await
                .is_err()
        );
        let (input, refs) = super::prepare(root.path(), "p", "t", input).await.unwrap();
        assert!(refs.is_empty());
        let value = super::provider_input(input).await.unwrap();
        assert_eq!(value["textAttachments"][0]["text"], "proof");
    }
}
