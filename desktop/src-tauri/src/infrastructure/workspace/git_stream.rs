//! 大清单逐条消费 NUL 记录；仅限制单条记录，文件数量不会触发输出容量错误。
use super::{git_process::configured_command, git_protocol::invalid, path_guard::WorkspaceError};
use std::{path::Path, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    sync::Semaphore,
};

static READ_SLOTS: Semaphore = Semaphore::const_new(2);
const MAX_RECORD_BYTES: usize = 64 * 1024;

pub(super) async fn fold_records<T, F>(
    repo: &Path,
    args: &[&str],
    mut state: T,
    mut consume: F,
) -> Result<T, WorkspaceError>
where
    F: FnMut(&mut T, &[u8]) -> Result<(), WorkspaceError>,
{
    let _permit = READ_SLOTS
        .acquire()
        .await
        .map_err(|_| invalid("stream", "reader closed"))?;
    let mut child = configured_command(repo, args, None, false, true)?
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                WorkspaceError::GitNotFound
            } else {
                error.into()
            }
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| invalid("stream", "missing stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| invalid("stream", "missing stderr"))?;
    let read_stdout = async {
        let mut reader = BufReader::with_capacity(16 * 1024, stdout);
        let mut record = Vec::new();
        loop {
            // fill_buf 避免 read_until 在损坏或异常输出上无限扩容。
            let bytes = reader.fill_buf().await?;
            if bytes.is_empty() {
                return if record.is_empty() {
                    Ok(())
                } else {
                    Err(invalid("stream", "missing NUL terminator"))
                };
            }
            let end = memchr::memchr(0, bytes);
            let count = end.map_or(bytes.len(), |index| index + 1);
            if record.len() + count > MAX_RECORD_BYTES {
                return Err(invalid("stream", "record exceeds path budget"));
            }
            record.extend_from_slice(&bytes[..count]);
            reader.consume(count);
            if end.is_some() {
                consume(&mut state, &record)?;
                record.clear();
            }
        }
    };
    let read_stderr = async {
        let mut bytes = Vec::new();
        stderr.take(64 * 1024 + 1).read_to_end(&mut bytes).await?;
        if bytes.len() > 64 * 1024 {
            return Err(invalid("stream", "stderr exceeded budget"));
        }
        Ok(bytes)
    };
    // 管道与 wait 同时推进；取消请求会丢弃 child 并终止只读 Git，配额随之释放。
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        tokio::try_join!(read_stdout, read_stderr, async {
            child.wait().await.map_err(WorkspaceError::from)
        })
    })
    .await;
    match result {
        Ok(Ok(((), stderr, status))) if !status.success() => Err(WorkspaceError::GitCommandFailed(
            format!("git {}: {}", args[0], String::from_utf8_lossy(&stderr)),
        )),
        Ok(Ok(_)) => Ok(state),
        Ok(Err(error)) => Err(error),
        Err(_) => Err(WorkspaceError::GitCommandFailed(format!(
            "git {} timed out after 30 seconds",
            args[0]
        ))),
    }
}
