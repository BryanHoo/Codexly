use super::error::AppError;
use crate::infrastructure::{local_catalog::LocalCatalog, workspace};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

pub(super) struct RestoredPlanPrompt {
    pub input: Value,
    directory: Option<PathBuf>,
}
impl RestoredPlanPrompt {
    /// 只移除本轮随机子目录，不触及同一任务已有的队列或历史附件。
    pub async fn discard(self) -> Result<(), AppError> {
        if let Some(path) = self.directory {
            tokio::fs::remove_dir_all(path)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
        }
        Ok(())
    }
}

pub(super) async fn restore(
    directory: &Path,
    catalog: &LocalCatalog,
    plan: &Value,
    task: &str,
    cancel: &CancellationToken,
) -> Result<RestoredPlanPrompt, AppError> {
    check_cancelled(cancel)?;
    if plan["source"] != "desktop" {
        return Err(AppError::ScheduledTaskInvalid);
    }
    let scope = json!({"source":"desktop","scheduleId":plan["scheduleId"],"projectId":plan["definition"]["projectId"],"expectedRevision":plan["revision"]});
    let resources = catalog.call("acp.resource.list", scope.clone()).await?;
    let resources = resources.as_array().ok_or(AppError::ScheduledTaskInvalid)?;
    let prompt = &plan["definition"]["prompt"];
    let refs = prompt["attachments"]
        .as_array()
        .ok_or(AppError::ScheduledTaskInvalid)?;
    let mut by_id = HashMap::new();
    for r in resources {
        let id = r["attachment"]["id"]
            .as_str()
            .ok_or(AppError::ScheduledTaskInvalid)?;
        if by_id.insert(id, r).is_some() {
            return Err(AppError::ScheduledTaskInvalid);
        }
    }
    let mut ids = HashSet::new();
    for reference in refs {
        let id = reference["id"]
            .as_str()
            .ok_or(AppError::ScheduledTaskInvalid)?;
        if !by_id.contains_key(id) || !ids.insert(id) {
            return Err(AppError::ScheduledTaskInvalid);
        }
    }
    if resources.len() != refs.len() {
        return Err(AppError::ScheduledTaskInvalid);
    }
    if refs.is_empty() {
        return Ok(RestoredPlanPrompt {
            input: prompt.clone(),
            directory: None,
        });
    }
    // 使用现有任务附件授权目录，并为本轮单独建子目录，不能直接暴露永久资源令牌。
    let parent = directory
        .join("attachments")
        .join(crate::infrastructure::queued_media::scope(task));
    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let output = parent.join(format!("acp-plan-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir(&output)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let result = async {
        let mut attachments = Vec::new();
        for (index, reference) in refs.iter().enumerate() {
            check_cancelled(cancel)?;
            let r = by_id
                .get(
                    reference["id"]
                        .as_str()
                        .ok_or(AppError::ScheduledTaskInvalid)?,
                )
                .ok_or(AppError::ScheduledTaskInvalid)?;
            let extension = match r["attachment"]["kind"].as_str() {
                Some("file") => "bin",
                Some("text") => "txt",
                Some("image") => match r["attachment"]["mediaType"].as_str() {
                    Some("image/png") => "png",
                    Some("image/jpeg") => "jpg",
                    Some("image/gif") => "gif",
                    Some("image/webp") => "webp",
                    _ => return Err(AppError::ScheduledTaskInvalid),
                },
                _ => return Err(AppError::ScheduledTaskInvalid),
            };
            let path = output.join(format!("{index}.{extension}"));
            write_resource(catalog, &scope, r, &path, cancel).await?;
            let mut attachment = r["attachment"].clone();
            attachment["id"] = json!(path);
            attachments.push(attachment);
        }
        check_cancelled(cancel)?;
        let mut input = prompt.clone();
        input["attachments"] = json!(attachments);
        Ok(RestoredPlanPrompt {
            input,
            directory: Some(output.clone()),
        })
    }
    .await;
    if result.is_err() {
        tokio::fs::remove_dir_all(output)
            .await
            .map_err(|_| AppError::FilesystemRequestFailed)?;
    }
    result
}

async fn write_resource(
    catalog: &LocalCatalog,
    scope: &Value,
    resource: &Value,
    path: &Path,
    cancel: &CancellationToken,
) -> Result<(), AppError> {
    let size = resource["attachment"]["size"]
        .as_i64()
        .filter(|n| *n > 0)
        .ok_or(AppError::ScheduledTaskInvalid)?;
    let digest = resource["digest"]
        .as_str()
        .ok_or(AppError::ScheduledTaskInvalid)?;
    let mut key = scope.clone();
    key["token"] = resource["token"].clone();
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let mut hash = Sha256::new();
    let mut offset = 0;
    let result = async {
        while offset < size {
            check_cancelled(cancel)?;
            let bytes = catalog
                .read_plan_resource_chunk(key.clone(), offset)
                .await?
                .filter(|b| !b.is_empty())
                .ok_or(AppError::ScheduledTaskInvalid)?;
            if bytes.len() as i64 > size - offset {
                return Err(AppError::ScheduledTaskInvalid);
            }
            hash.update(&bytes);
            file.write_all(&bytes)
                .await
                .map_err(|_| AppError::FilesystemRequestFailed)?;
            offset += bytes.len() as i64;
        }
        // 块摘要只证明单块一致；完整摘要还核对本轮确实恢复了原封存的全部字节。
        if crate::encoding::encode_lower_hex(hash.finalize()) != digest {
            return Err(AppError::ScheduledTaskInvalid);
        }
        Ok(())
    }
    .await;
    // 错误 / 取消也等待已经提交的文件写入结束，避免 Windows 清理与后台写入竞争。
    file.flush()
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    result
}

pub(super) async fn stage(
    directory: &Path,
    catalog: &LocalCatalog,
    schedule: &str,
    project: &str,
    attachment: &Value,
    cancel: &CancellationToken,
) -> Result<Value, AppError> {
    check_cancelled(cancel)?;
    let id = attachment["id"]
        .as_str()
        .ok_or(AppError::FilesystemRequestFailed)?;
    // 只接受当前项目已导入的副本，不能把前端路径直接作为文件读取权限。
    let path = workspace::validate_attachment(directory, project, id).await?;
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    let size = file
        .metadata()
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?
        .len();
    if attachment["size"].as_u64() != Some(size) {
        return Err(AppError::FilesystemRequestFailed);
    }
    let key = json!({"source":"desktop","scheduleId":schedule,"projectId":project,"token":uuid::Uuid::new_v4().to_string()});
    let mut metadata = attachment.clone();
    metadata["id"] = json!(uuid::Uuid::new_v4().to_string());
    let result = async {
        check_cancelled(cancel)?;
        let mut input = key.clone();
        input["attachment"] = metadata;
        catalog.call("acp.resource.begin", input).await?;
        let mut offset = 0;
        let mut buffer = vec![0; 262144];
        loop {
            check_cancelled(cancel)?;
            let read = tokio::select! {
                _ = cancel.cancelled() => return Err(AppError::RequestCancelled),
                read = file.read(&mut buffer) => read.map_err(|_| AppError::FilesystemRequestFailed)?,
            };
            if read == 0 { break; }
            // 原始块经类型化端口传递；逐块等待数据库，堆内存不随文件长度增长。
            offset = catalog.append_plan_resource(key.clone(), offset, buffer[..read].to_vec()).await?;
        }
        check_cancelled(cancel)?;
        catalog.call("acp.resource.seal", key.clone()).await.map_err(AppError::from)
    }.await;
    if result.is_err() {
        // 原上传仍供草稿 / 重试使用，只回收本次独立暂存。进程中断残留由暂存 TTL 回收。
        catalog.call("acp.resource.abort", key).await?;
    }
    result
}

fn check_cancelled(cancel: &CancellationToken) -> Result<(), AppError> {
    if cancel.is_cancelled() {
        Err(AppError::RequestCancelled)
    } else {
        Ok(())
    }
}

#[cfg(test)]
#[path = "acp_plan_resource_transfer_tests.rs"]
mod tests;
