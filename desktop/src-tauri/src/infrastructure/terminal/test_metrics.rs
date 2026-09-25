use super::manager::TerminalManager;
use serde_json::{Value, json};

impl TerminalManager {
    pub fn test_metrics(&self) -> Value {
        let registry = self.lock();
        // 此模块仅存在于测试 feature，指标不包含目录、命令、环境变量或输出。
        let sessions: Vec<_> = registry.entries.values().map(|entry| json!({
            "pid": entry.session.as_ref().map(|session| session.process_id()),
            "state": entry.metadata.as_ref().map(|metadata| metadata.state),
            "outstandingBytes": entry.transport.as_ref().map_or(0, |transport| transport.outstanding_bytes()),
            "queuedInputBytes": entry.transport.as_ref().map_or(0, |transport| transport.queued_input_bytes()),
        })).collect();
        json!({ "appPid": std::process::id(), "liveCount": registry.quotas.total(), "sessions": sessions })
    }
}
