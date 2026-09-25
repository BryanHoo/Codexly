use super::*;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[tokio::test]
async fn turn_start_should_retry_after_runtime_becomes_available() {
    let registry = TurnStartRegistry::default();
    let error = registry
        .run("key", identity(1), async {
            Err(AppError::CodexRuntimeUnavailable)
        })
        .await
        .unwrap_err();
    assert_eq!(error, json!("Codex runtime is unavailable"));
    let result = registry
        .run("key", identity(1), async { Ok(json!({"turn": "new"})) })
        .await;
    assert_eq!(result.unwrap(), json!({"turn": "new"}));
}

#[tokio::test]
async fn turn_start_retry_should_preserve_identity_capacity_and_original_retention() {
    let registry = TurnStartRegistry::default();
    for index in 0..CAPACITY {
        registry
            .run(&index.to_string(), identity(1), async {
                Err(AppError::CodexRuntimeUnavailable)
            })
            .await
            .unwrap_err();
    }
    let registered = registry.entries.lock().unwrap()["0"].started;
    let error = registry
        .run("0", identity(2), async {
            panic!("retry must not change input")
        })
        .await
        .unwrap_err();
    assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
    let error = registry
        .run("extra", identity(1), async {
            panic!("new keys must respect capacity")
        })
        .await
        .unwrap_err();
    assert_eq!(error["code"], "IDEMPOTENCY_CAPACITY_EXCEEDED");
    registry
        .run("0", identity(1), async { Ok(json!({"turn": "new"})) })
        .await
        .unwrap();
    let entries = registry.entries.lock().unwrap();
    assert_eq!(entries.len(), CAPACITY);
    assert_eq!(entries["0"].started, registered);
}

#[tokio::test]
async fn turn_start_retry_should_not_trust_rpc_error_text() {
    let registry = TurnStartRegistry::default();
    let error = registry
        .run("key", identity(1), async {
            Err(AppError::CodexRpc {
                rpc_code: -32603,
                message: "Codex runtime is unavailable".into(),
            })
        })
        .await
        .unwrap_err();
    assert_eq!(
        registry
            .run("key", identity(1), async {
                panic!("RPC error must not permit repeated execution")
            })
            .await
            .unwrap_err(),
        error
    );
}

#[tokio::test]
async fn turn_start_retry_should_merge_concurrent_retries_and_preserve_old_waiters() {
    let registry = TurnStartRegistry::default();
    let error = registry
        .run("key", identity(1), async {
            Err(AppError::CodexRuntimeUnavailable)
        })
        .await
        .unwrap_err();
    let old = registry.entries.lock().unwrap()["key"].result.clone();
    let release = Arc::new(tokio::sync::Notify::new());
    let mut first = Box::pin(registry.run("key", identity(1), {
        let release = Arc::clone(&release);
        async move {
            release.notified().await;
            Ok(json!({"turn": "new"}))
        }
    }));
    let mut second = Box::pin(registry.run("key", identity(1), async {
        panic!("concurrent retry must share execution")
    }));
    std::future::poll_fn(|context| {
        assert!(first.as_mut().poll(context).is_pending());
        assert!(second.as_mut().poll(context).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    release.notify_one();
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first.unwrap(), json!({"turn": "new"}));
    assert_eq!(second.unwrap(), json!({"turn": "new"}));
    assert_eq!(
        wait_for_result(old, Duration::ZERO).await.unwrap_err(),
        error
    );
    assert_eq!(
        registry
            .run("key", identity(1), async {
                panic!("successful retry must replay")
            })
            .await
            .unwrap(),
        json!({"turn": "new"})
    );
}

#[tokio::test]
async fn turn_start_should_replay_without_executing_again() {
    let registry = TurnStartRegistry::default();
    let calls = Arc::new(AtomicUsize::new(0));
    for _ in 0..2 {
        let calls = Arc::clone(&calls);
        let result = registry
            .run("turn-key", identity(1), async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"taskId": "task-a", "turn": {"id": "turn-a"}}))
            })
            .await
            .unwrap();
        assert_eq!(result["turn"]["id"], "turn-a");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

fn identity(value: u8) -> TurnStartIdentity {
    TurnStartIdentity {
        digest: [value; 32],
        bytes: 1,
    }
}

#[tokio::test]
async fn turn_start_should_reject_changed_request_without_executing_it() {
    let registry = TurnStartRegistry::default();
    registry
        .run("key", identity(1), async {
            Ok(json!({"turn": "original"}))
        })
        .await
        .unwrap();
    let error = registry
        .run("key", identity(2), async {
            panic!("conflicting request must not execute")
        })
        .await
        .unwrap_err();
    assert_eq!(error["code"], "IDEMPOTENCY_CONFLICT");
}

#[tokio::test]
async fn turn_start_should_replay_original_rpc_failure() {
    let registry = TurnStartRegistry::default();
    let error = registry
        .run("key", identity(1), async {
            Err(AppError::CodexRpc {
                rpc_code: -32602,
                message: "invalid model".into(),
            })
        })
        .await
        .unwrap_err();
    assert_eq!(
        error,
        json!({"code": "CODEX_RPC_ERROR", "rpcCode": -32602, "message": "invalid model"})
    );
    let replay = registry
        .run("key", identity(1), async {
            panic!("failed attempt must not execute again")
        })
        .await
        .unwrap_err();
    assert_eq!(replay, error);
}

#[tokio::test]
async fn turn_start_should_validate_key_before_executing() {
    for key in ["".to_owned(), " \n".to_owned(), "x".repeat(129)] {
        let registry = TurnStartRegistry::default();
        let error = registry
            .run(&key, identity(1), async {
                panic!("invalid key must not execute")
            })
            .await
            .unwrap_err();
        assert_eq!(error["code"], "INVALID_REQUEST");
    }
}

#[tokio::test]
async fn turn_start_should_continue_after_cancellation_timeout_and_expiry() {
    let registry = Arc::new(TurnStartRegistry::default());
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let first = {
        let (registry, entered, release) = (
            Arc::clone(&registry),
            Arc::clone(&entered),
            Arc::clone(&release),
        );
        tokio::spawn(async move {
            registry
                .run("key", identity(1), async move {
                    entered.notify_one();
                    release.notified().await;
                    Ok(json!({"turn": "original"}))
                })
                .await
        })
    };
    entered.notified().await;
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    let receiver = {
        let mut entries = registry.entries.lock().unwrap();
        let entry = entries.get_mut("key").unwrap();
        entry.started = Instant::now() - RETENTION;
        entry.result.clone()
    };
    let error = wait_for_result(receiver, Duration::ZERO).await.unwrap_err();
    assert_eq!(error["code"], "TURN_START_UNCERTAIN");
    let mut second = Box::pin(registry.run("key", identity(1), async {
        panic!("in-flight work must not restart")
    }));
    // 显式轮询到等待状态，不依赖调度器碰巧先运行第二个调用。
    std::future::poll_fn(|context| {
        assert!(second.as_mut().poll(context).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    release.notify_one();
    assert_eq!(second.await.unwrap(), json!({"turn": "original"}));
}

#[tokio::test]
async fn turn_start_should_keep_live_results_at_capacity_and_reclaim_expired_results() {
    let registry = TurnStartRegistry::default();
    for index in 0..CAPACITY {
        registry
            .run(&index.to_string(), identity(1), async {
                Ok(json!({"turn": "original"}))
            })
            .await
            .unwrap();
    }
    let error = registry
        .run("overflow", identity(1), async {
            panic!("capacity must reject before execution")
        })
        .await
        .unwrap_err();
    assert_eq!(error["code"], "IDEMPOTENCY_CAPACITY_EXCEEDED");
    assert_eq!(
        registry
            .run("0", identity(1), async {
                panic!("live result must be retained")
            })
            .await
            .unwrap(),
        json!({"turn": "original"})
    );
    registry
        .entries
        .lock()
        .unwrap()
        .get_mut("0")
        .unwrap()
        .started = Instant::now() - RETENTION;
    registry
        .run("overflow", identity(1), async {
            Ok(json!({"turn": "new"}))
        })
        .await
        .unwrap();
    assert_eq!(registry.entries.lock().unwrap().len(), CAPACITY);
}

#[tokio::test]
async fn turn_start_should_bound_inflight_input_bytes() {
    let registry = Arc::new(TurnStartRegistry::default());
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let first = {
        let (registry, entered, release) = (
            Arc::clone(&registry),
            Arc::clone(&entered),
            Arc::clone(&release),
        );
        tokio::spawn(async move {
            let mut request = identity(1);
            request.bytes = MAX_INFLIGHT_BYTES;
            registry
                .run("large", request, async move {
                    entered.notify_one();
                    release.notified().await;
                    Ok(json!({"turn": "original"}))
                })
                .await
        })
    };
    entered.notified().await;
    let error = registry
        .run("extra", identity(2), async {
            panic!("byte budget must reject before execution")
        })
        .await
        .unwrap_err();
    assert_eq!(error["code"], "IDEMPOTENCY_CAPACITY_EXCEEDED");
    release.notify_one();
    first.await.unwrap().unwrap();
    registry
        .run("extra", identity(2), async { Ok(json!({"turn": "next"})) })
        .await
        .unwrap();
}

#[tokio::test]
async fn turn_start_should_retain_uncertain_result_after_worker_panic() {
    let registry = TurnStartRegistry::default();
    let error = registry
        .run("key", identity(1), async {
            panic!("simulated worker panic")
        })
        .await
        .unwrap_err();
    assert_eq!(error["code"], "TURN_START_UNCERTAIN");
    assert_eq!(
        registry
            .run("key", identity(1), async {
                panic!("must not take over side effects")
            })
            .await
            .unwrap_err(),
        error
    );
}

#[tokio::test]
async fn turn_start_should_bound_encoded_result_and_retain_uncertainty() {
    let registry = TurnStartRegistry::default();
    // 转义后的 JSON 超过 64 KiB，即使原始字符串未超限也不能绕过编码预算。
    let error = registry
        .run("key", identity(1), async {
            Ok(json!({"text": "\0".repeat(11_000)}))
        })
        .await
        .unwrap_err();
    assert_eq!(error["code"], "TURN_START_UNCERTAIN");
    assert!(
        registry.entries.lock().unwrap()["key"]
            .result
            .borrow()
            .as_ref()
            .unwrap()
            .len()
            <= 64 * 1024
    );
    assert_eq!(
        registry
            .run("key", identity(1), async {
                panic!("oversized response must not permit restarting")
            })
            .await
            .unwrap_err(),
        error
    );
}
