use crate::encoding::encode_lower_hex;
use sha2::{Digest, Sha256};

/// 队列快照按任务隔离，不能借另一个任务的附件身份绕过提交校验。
pub(crate) fn scope(task_id: &str) -> String {
    format!(
        "queued-{}",
        encode_lower_hex(Sha256::digest(task_id.as_bytes()))
    )
}
