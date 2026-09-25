use std::sync::Arc;

use tokio::sync::{Mutex, OwnedMutexGuard};

use super::RuntimeSession;
use crate::domain::runtime::AppEvent;

pub(super) struct EventDelivery {
    task_windows: Arc<super::super::task_window_runtime::TaskWindowRuntime>,
    _order: OwnedMutexGuard<()>,
    sender: Option<Arc<super::event_stream::RuntimeEventStream>>,
}

impl EventDelivery {
    pub(super) async fn send(self, event: AppEvent) {
        self.task_windows.observe(&event);
        if let Some(sender) = self.sender {
            // ACK 只约束 WebView 在途数据，不阻塞原生事实、审批登记或 RPC 应答。
            sender.publish(event);
        }
    }
}

pub(super) async fn prepare_event_delivery(runtime: &Arc<Mutex<RuntimeSession>>) -> EventDelivery {
    let event_order = Arc::clone(&runtime.lock().await.event_order);
    let order = event_order.lock_owned().await;
    let session = runtime.lock().await;
    let sender = session.event_sender.clone();
    // 序号分配和发送共享顺序锁，防止多个发布者在背压期间交错投递。
    EventDelivery {
        task_windows: Arc::clone(&session.task_windows),
        _order: order,
        sender,
    }
}
