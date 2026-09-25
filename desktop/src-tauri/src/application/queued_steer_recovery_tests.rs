use super::*;

#[tokio::test]
async fn idle_consumption_should_retry_original_key_after_capacity_recovers() {
    let registry = Arc::new(QueuedSteerRegistry::default());
    for index in 0..CAPACITY {
        registry.acquire([index as u8; 32]).unwrap();
    }
    let starts = TurnStartRegistry::default();
    for attempt in 0..2 {
        let worker = Arc::clone(&registry);
        let identity = super::super::super::turn_start::fingerprint_queue_start(
            "project",
            "task",
            Some("queue"),
        )
        .unwrap();
        let result = starts
            .run("original", identity, async move {
                let _lease = worker
                    .reserve_idle_start("project", "task", "queue")
                    .await?;
                Ok(json!({"turn": "original"}))
            })
            .await;
        if attempt == 0 {
            assert_eq!(result.unwrap_err()["code"], "IDEMPOTENCY_CAPACITY_EXCEEDED");
            for entry in registry.entries.lock().unwrap().values_mut() {
                entry.created = Instant::now() - RETENTION;
            }
        } else {
            assert_eq!(result.unwrap()["turn"], "original");
        }
    }
}

#[tokio::test]
async fn idle_consumption_should_hold_lock_and_pin_expired_attempt() {
    use std::{future::Future, task::Poll};
    let registry = QueuedSteerRegistry::default();
    let lease = registry
        .reserve_idle_start("project", "task", "queue")
        .await
        .unwrap()
        .unwrap();
    for entry in registry.entries.lock().unwrap().values_mut() {
        entry.created = Instant::now() - RETENTION;
    }
    registry.acquire([255; 32]).unwrap();
    assert_eq!(registry.entries.lock().unwrap().len(), 2);
    let mut competing = Box::pin(registry.reserve_idle_start("project", "task", "queue"));
    // 确定性轮询证明同项请求确实等待租约，避免依赖调度时长。
    assert!(std::future::poll_fn(|cx| Poll::Ready(competing.as_mut().poll(cx).is_pending())).await);
    drop(lease);
    assert!(matches!(
        competing.await,
        Err(AppError::QueueRecoveryUncertain)
    ));
    registry.acquire([254; 32]).unwrap();
    assert!(
        registry
            .reserve_idle_start("project", "task", "queue")
            .await
            .unwrap()
            .is_some()
    );
}

#[test]
fn recovery_should_bound_entries_and_retain_active_leases() {
    let registry = QueuedSteerRegistry::default();
    let active = registry.acquire([0; 32]).unwrap();
    for index in 1..CAPACITY {
        registry.acquire([index as u8; 32]).unwrap();
    }
    assert_eq!(
        serde_json::to_value(registry.acquire([255; 32]).err().unwrap()).unwrap()["code"],
        "IDEMPOTENCY_CAPACITY_EXCEEDED"
    );
    assert!(Arc::ptr_eq(&active, &registry.acquire([0; 32]).unwrap()));
    for entry in registry.entries.lock().unwrap().values_mut() {
        entry.created = Instant::now() - RETENTION;
    }
    registry.acquire([255; 32]).unwrap();
    assert_eq!(registry.entries.lock().unwrap().len(), 2);
    assert!(Arc::ptr_eq(&active, &registry.acquire([0; 32]).unwrap()));
    drop(active);
    registry.acquire([254; 32]).unwrap();
    assert!(!registry.entries.lock().unwrap().contains_key(&[0; 32]));
}
