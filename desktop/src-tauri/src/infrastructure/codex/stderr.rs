use std::collections::BTreeMap;

use tokio::{
    io::{self, AsyncBufRead, AsyncBufReadExt, AsyncRead, BufReader},
    sync::mpsc,
    task::JoinHandle,
};

use crate::infrastructure::diagnostics::{
    self, CodexLogParseError, DiagnosticLevel, DiagnosticSession, parse_codex_event,
};

const CODEX_LOG_QUEUE_CAPACITY: usize = 512;

pub(super) fn spawn_codex_stderr_tasks<R>(
    stderr: R,
    connection_seq: u64,
) -> (JoinHandle<()>, JoinHandle<()>)
where
    R: AsyncRead + Send + Unpin + 'static,
{
    let (sender, mut receiver) = mpsc::channel(CODEX_LOG_QUEUE_CAPACITY);
    let writer_task = tokio::spawn(async move {
        while let Some(event) = receiver.recv().await {
            diagnostics::record_codex_event(event);
        }
    });
    let session = diagnostics::session().clone();
    let reader_task = tokio::spawn(async move {
        drain_codex_stderr(stderr, sender, session, connection_seq).await;
    });
    (reader_task, writer_task)
}

async fn drain_codex_stderr<R>(
    stderr: R,
    sender: mpsc::Sender<diagnostics::DiagnosticEvent>,
    session: DiagnosticSession,
    connection_seq: u64,
) where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::new(stderr);
    let mut line = Vec::with_capacity(1_024);
    let mut stats = IngestStats::new(connection_seq);
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    interval.tick().await;

    loop {
        let result = {
            // 定时汇总不能取消正在读取的半行，否则会丢失已消费的 stderr 字节。
            let read = read_bounded_line(
                &mut reader,
                &mut line,
                diagnostics::MAX_CODEX_LOG_LINE_BYTES,
            );
            tokio::pin!(read);
            loop {
                tokio::select! {
                    result = &mut read => break result,
                    _ = interval.tick() => stats.report(),
                }
            }
        };
        match result {
            Ok(Some(true)) => stats.oversized_lines += 1,
            Ok(Some(false)) => match parse_codex_event(&line, &session) {
                Ok(Some(mut event)) => {
                    // 关联号由宿主生成，不信任子进程传入的同名字段。
                    event.context.remove("connectionSeq");
                    if event.context.len() >= 16 {
                        event.context.pop_last();
                    }
                    event
                        .context
                        .insert("connectionSeq".to_owned(), connection_seq.into());
                    if let Err(error) = sender.try_send(event) {
                        stats.dropped_events += 1;
                        if error.into_inner().level == DiagnosticLevel::Error {
                            stats.dropped_errors += 1;
                        }
                    }
                }
                Ok(None) => {}
                Err(CodexLogParseError::TooLarge) => stats.oversized_lines += 1,
                Err(_) => stats.invalid_lines += 1,
            },
            Ok(None) => break,
            Err(error) => {
                diagnostics::record(
                    DiagnosticLevel::Warn,
                    "codex_log_read_failed",
                    Some(error.to_string()),
                    BTreeMap::from([("connectionSeq".to_owned(), connection_seq.into())]),
                );
                break;
            }
        }
        // 首次丢失立即可见；持续异常最多每五秒汇总一次，避免告警自身刷屏。
        if !stats.reported {
            stats.report();
        }
    }
    stats.report();
}

struct IngestStats {
    connection_seq: u64,
    invalid_lines: u64,
    oversized_lines: u64,
    dropped_events: u64,
    dropped_errors: u64,
    reported: bool,
}

impl IngestStats {
    fn new(connection_seq: u64) -> Self {
        Self {
            connection_seq,
            invalid_lines: 0,
            oversized_lines: 0,
            dropped_events: 0,
            dropped_errors: 0,
            reported: false,
        }
    }

    fn report(&mut self) {
        if self.invalid_lines + self.oversized_lines + self.dropped_events == 0 {
            return;
        }
        diagnostics::record(
            DiagnosticLevel::Warn,
            "codex_log_ingest_summary",
            None,
            BTreeMap::from([
                ("connectionSeq".to_owned(), self.connection_seq.into()),
                ("droppedEvents".to_owned(), self.dropped_events.into()),
                ("droppedErrors".to_owned(), self.dropped_errors.into()),
                ("invalidLines".to_owned(), self.invalid_lines.into()),
                ("oversizedLines".to_owned(), self.oversized_lines.into()),
            ]),
        );
        self.invalid_lines = 0;
        self.oversized_lines = 0;
        self.dropped_events = 0;
        self.dropped_errors = 0;
        self.reported = true;
    }
}

async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    output: &mut Vec<u8>,
    limit: usize,
) -> io::Result<Option<bool>> {
    output.clear();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return if output.is_empty() && !oversized {
                Ok(None)
            } else {
                Ok(Some(oversized))
            };
        }
        let newline = memchr::memchr(b'\n', available);
        let content_len = newline.unwrap_or(available.len());
        let remaining = limit.saturating_sub(output.len());
        output.extend_from_slice(&available[..content_len.min(remaining)]);
        oversized |= content_len > remaining;
        let consumed = newline.map_or(available.len(), |position| position + 1);
        reader.consume(consumed);
        if newline.is_some() {
            if output.last() == Some(&b'\r') {
                output.pop();
            }
            return Ok(Some(oversized));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::read_bounded_line;

    #[tokio::test]
    async fn diagnostic_full_log_queue_counts_dropped_errors() {
        let capture = crate::infrastructure::diagnostics::test_support::Capture::start();
        let (sender, _receiver) = tokio::sync::mpsc::channel(1);
        let line = "{\"timestamp\":\"2026-09-14T00:00:00Z\",\"level\":\"ERROR\",\"target\":\"codex_core\",\"fields\":{\"message\":\"failure\"}}\n";
        let input = line.repeat(3);
        super::drain_codex_stderr(
            input.as_bytes(),
            sender,
            super::diagnostics::session().clone(),
            42,
        )
        .await;
        let events = capture.take();
        let summaries: Vec<_> = events
            .iter()
            .filter(|event| event["event"] == "codex_log_ingest_summary")
            .collect();
        assert_eq!(
            summaries
                .iter()
                .map(|event| event["context"]["droppedErrors"].as_u64().unwrap())
                .sum::<u64>(),
            2
        );
        assert!(
            summaries
                .iter()
                .all(|event| event["context"]["connectionSeq"] == 42)
        );
    }

    #[tokio::test]
    async fn diagnostic_ingest_reports_loss_before_stderr_closes() {
        use tokio::io::AsyncWriteExt as _;
        let capture = crate::infrastructure::diagnostics::test_support::Capture::start();
        let (reader, mut writer) = tokio::io::duplex(1024);
        let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
        let task = tokio::spawn(super::drain_codex_stderr(
            reader,
            sender,
            super::diagnostics::session().clone(),
            42,
        ));
        writer.write_all(b"not-json\n{\"timestamp\":\"2026-09-14T00:00:00Z\",\"level\":\"WARN\",\"target\":\"codex_core\",\"fields\":{\"message\":\"sentinel\"}}\n").await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), receiver.recv())
            .await
            .unwrap()
            .unwrap();
        let events = capture.take();
        task.abort();
        assert!(
            events
                .iter()
                .any(|event| event["event"] == "codex_log_ingest_summary"
                    && event["context"]["invalidLines"] == 1)
        );
    }

    #[tokio::test]
    async fn codex_stderr_reader_should_bound_each_line_and_continue() {
        let mut input = vec![b'x'; 128];
        input.extend_from_slice(b"\n{}\n");
        let mut reader = tokio::io::BufReader::new(input.as_slice());
        let mut output = Vec::new();

        assert_eq!(
            read_bounded_line(&mut reader, &mut output, 64)
                .await
                .unwrap(),
            Some(true)
        );
        assert_eq!(output.len(), 64);
        assert_eq!(
            read_bounded_line(&mut reader, &mut output, 64)
                .await
                .unwrap(),
            Some(false)
        );
        assert_eq!(output, b"{}");
    }
}
