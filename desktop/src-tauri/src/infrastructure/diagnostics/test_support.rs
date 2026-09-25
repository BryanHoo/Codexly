use std::{cell::RefCell, sync::Once};

use serde_json::Value;

thread_local! {
    static EVENTS: RefCell<Option<Vec<Value>>> = const { RefCell::new(None) };
}
static INITIALIZE: Once = Once::new();
static LOGGER: TestLogger = TestLogger;
struct TestLogger;
impl log::Log for TestLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.target() == "codeagent"
    }
    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        EVENTS.with_borrow_mut(|events| {
            if let Some(events) = events {
                events.push(serde_json::from_str(&record.args().to_string()).unwrap());
            }
        });
    }
    fn flush(&self) {}
}

// 每个测试线程独立捕获实际落入 logger 的 JSON，避免并发测试相互污染。
pub(crate) struct Capture;
impl Capture {
    pub(crate) fn start() -> Self {
        INITIALIZE.call_once(|| {
            log::set_logger(&LOGGER).unwrap();
            log::set_max_level(log::LevelFilter::Info);
        });
        EVENTS.with_borrow_mut(|events| *events = Some(Vec::new()));
        Self
    }
    pub(crate) fn take(&self) -> Vec<Value> {
        EVENTS.with_borrow_mut(|events| std::mem::take(events.as_mut().unwrap()))
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        EVENTS.with_borrow_mut(|events| *events = None);
    }
}
