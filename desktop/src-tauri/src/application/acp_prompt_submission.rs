use super::error::AppError;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::io::{self, Write};

struct Fingerprint {
    digest: Sha256,
    bytes: usize,
}
impl Write for Fingerprint {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.bytes.saturating_add(bytes.len()) > 8 * 1024 * 1024 {
            return Err(io::Error::other("ACP input exceeds submission budget"));
        }
        self.bytes += bytes.len();
        self.digest.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// 原始应用输入决定幂等身份；授权解析后的临时路径不能改变重试指纹。
pub(super) fn identity(project: &str, params: &Value) -> Result<(Value, usize), AppError> {
    let mut hash = Fingerprint {
        digest: Sha256::new(),
        bytes: 0,
    };
    serde_json::to_writer(&mut hash, &(project, params))
        .map_err(|_| AppError::QueueRecoveryCapacityExceeded)?;
    Ok((
        json!({"projectId":project,"taskId":params["taskId"],"key":params["idempotencyKey"],
        "fingerprint":crate::encoding::encode_lower_hex(hash.digest.finalize())}),
        hash.bytes,
    ))
}

pub(super) fn replay(response: &Value) -> Result<Option<Value>, AppError> {
    match response["status"].as_str() {
        Some("available" | "reserved") => Ok(None),
        Some("completed") => Ok(Some(response["result"].clone())),
        Some("conflict") => Err(AppError::AcpSubmissionConflict),
        _ => Err(AppError::AcpSubmissionUnknown),
    }
}
