use crate::domain::runtime::{CodexRuntimeInstallPhase, CodexRuntimeInstallProgress};

const UNKNOWN_TOTAL_REPORT_INTERVAL_BYTES: u64 = 1024 * 1024;

pub(super) struct DownloadProgressReporter<'a, OnProgress> {
    current_version: Option<String>,
    downloaded_bytes: u64,
    on_progress: &'a OnProgress,
    sequence: u64,
    total_bytes: Option<u64>,
}

impl<'a, OnProgress> DownloadProgressReporter<'a, OnProgress>
where
    OnProgress: Fn(CodexRuntimeInstallProgress),
{
    pub(super) fn new(on_progress: &'a OnProgress, current_version: Option<String>) -> Self {
        Self {
            current_version,
            downloaded_bytes: 0,
            on_progress,
            sequence: 0,
            total_bytes: None,
        }
    }

    pub(super) fn start_download(&mut self, total_bytes: Option<u64>) {
        self.downloaded_bytes = 0;
        self.total_bytes = total_bytes;
        self.report(CodexRuntimeInstallPhase::Downloading);
    }

    pub(super) fn report_download(&mut self, downloaded_bytes: u64) {
        self.downloaded_bytes = downloaded_bytes;
        self.report(CodexRuntimeInstallPhase::Downloading);
    }

    pub(super) fn report_phase(&mut self, phase: CodexRuntimeInstallPhase) {
        self.report(phase);
    }

    fn report(&mut self, phase: CodexRuntimeInstallPhase) {
        self.sequence = self.sequence.saturating_add(1);
        (self.on_progress)(CodexRuntimeInstallProgress {
            current_version: self.current_version.clone(),
            downloaded_bytes: self.downloaded_bytes,
            phase,
            sequence: self.sequence,
            target_version: super::process::SUPPORTED_CODEX_VERSION,
            total_bytes: self.total_bytes,
        });
    }
}

pub(super) struct DownloadProgressLimiter {
    last_downloaded_bytes: u64,
    last_percentage: Option<u64>,
    total_bytes: Option<u64>,
}

impl DownloadProgressLimiter {
    pub(super) fn new(total_bytes: Option<u64>) -> Self {
        Self {
            last_downloaded_bytes: 0,
            last_percentage: total_bytes.map(|_| 0),
            total_bytes,
        }
    }

    pub(super) fn advance(&mut self, downloaded_bytes: u64) -> bool {
        let percentage = self.total_bytes.map(|total_bytes| {
            (downloaded_bytes.saturating_mul(100) / total_bytes.max(1)).min(100)
        });
        let should_report = match percentage {
            Some(percentage) => Some(percentage) != self.last_percentage,
            None => {
                downloaded_bytes.saturating_sub(self.last_downloaded_bytes)
                    >= UNKNOWN_TOTAL_REPORT_INTERVAL_BYTES
            }
        };
        if should_report {
            self.last_downloaded_bytes = downloaded_bytes;
            self.last_percentage = percentage;
        }
        should_report
    }

    pub(super) fn finish(&mut self, downloaded_bytes: u64) -> bool {
        if self.total_bytes.is_some() || downloaded_bytes == self.last_downloaded_bytes {
            return false;
        }
        self.last_downloaded_bytes = downloaded_bytes;
        true
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::{CodexRuntimeInstallPhase, DownloadProgressLimiter, DownloadProgressReporter};

    #[test]
    fn switching_download_source_should_reset_bytes_but_preserve_sequence() {
        let events = Mutex::new(Vec::new());
        let on_progress = |progress| events.lock().unwrap().push(progress);
        let mut reporter = DownloadProgressReporter::new(&on_progress, None);
        reporter.start_download(Some(100));
        reporter.report_download(80);
        reporter.start_download(Some(200));
        let events = events.lock().unwrap();
        assert_eq!(events[2].downloaded_bytes, 0);
        assert_eq!(events[2].total_bytes, Some(200));
        assert_eq!(events[2].sequence, 3);
    }

    #[test]
    fn reporter_should_assign_monotonic_sequence_numbers() {
        let events = Mutex::new(Vec::new());
        let on_progress = |progress| events.lock().unwrap().push(progress);
        let mut reporter = DownloadProgressReporter::new(&on_progress, Some("0.150.0".to_owned()));

        reporter.report_phase(CodexRuntimeInstallPhase::Preparing);
        reporter.start_download(Some(100));
        reporter.report_download(20);
        reporter.report_phase(CodexRuntimeInstallPhase::Installing);

        let events = events.lock().unwrap();
        assert_eq!(events[0].sequence, 1);
        assert_eq!(events[1].sequence, 2);
        assert_eq!(events[2].sequence, 3);
        assert_eq!(events[3].sequence, 4);
        assert_eq!(events[3].phase, CodexRuntimeInstallPhase::Installing);
    }

    #[test]
    fn known_download_size_should_report_at_most_once_per_percentage() {
        let mut limiter = DownloadProgressLimiter::new(Some(1_000));

        assert!(!limiter.advance(9));
        assert!(limiter.advance(10));
        assert!(!limiter.advance(19));
        assert!(limiter.advance(20));
        assert!(limiter.advance(1_000));
        assert!(!limiter.advance(1_100));
        assert!(!limiter.finish(1_100));
    }

    #[test]
    fn unknown_download_size_should_report_in_bounded_byte_intervals() {
        let mut limiter = DownloadProgressLimiter::new(None);

        assert!(!limiter.advance(1024 * 1024 - 1));
        assert!(limiter.advance(1024 * 1024));
        assert!(!limiter.advance(1024 * 1024 + 1));
        assert!(limiter.finish(1024 * 1024 + 1));
    }
}
