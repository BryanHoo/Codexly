use std::time::Duration;

use super::*;

fn stalled_writer(capacity: usize) -> (AppStorageRuntime, mpsc::Receiver<PreferenceWriterMessage>) {
    let (sender, receiver) = mpsc::channel(capacity);
    let runtime = AppStorageRuntime {
        state: Mutex::new(StorageWriterState {
            sender: Some(sender),
            ..StorageWriterState::default()
        }),
    };
    (runtime, receiver)
}

#[tokio::test]
async fn full_queue_should_not_lock_state_during_shutdown() {
    let (runtime, _receiver) = stalled_writer(1);
    runtime
        .enqueue(PathBuf::new(), BTreeMap::new())
        .await
        .unwrap();
    let mut shutdown = Box::pin(runtime.shutdown());
    tokio::select! {
        _ = &mut shutdown => panic!("shutdown must wait for queue capacity"),
        _ = tokio::time::sleep(Duration::from_millis(20)) => {},
    }

    let state = tokio::time::timeout(Duration::from_millis(100), runtime.state.lock()).await;
    assert!(
        state.is_ok(),
        "queue backpressure must not hold the state lock"
    );
    drop(state);
    drop(shutdown);
    assert!(!runtime.state.lock().await.closing);
}

#[tokio::test]
async fn stalled_writer_should_timeout_and_preserve_accepted_messages_for_retry() {
    let (runtime, mut receiver) = stalled_writer(PREFERENCE_QUEUE_CAPACITY);
    let first = BTreeMap::from([("codeagent.draft".into(), Some("unsaved".into()))]);
    runtime
        .enqueue(PathBuf::new(), first.clone())
        .await
        .unwrap();

    let result = tokio::time::timeout(Duration::from_secs(6), runtime.shutdown())
        .await
        .unwrap();
    assert!(result.is_err());
    let newer = BTreeMap::from([("codeagent.draft".into(), Some("newer".into()))]);
    runtime
        .enqueue(PathBuf::new(), newer.clone())
        .await
        .unwrap();
    let PreferenceWriterMessage::Updates(accepted) = receiver.recv().await.unwrap() else {
        panic!("accepted update must precede the flush barrier");
    };
    assert_eq!(accepted, first);
    let PreferenceWriterMessage::Flush(stale_completion) = receiver.recv().await.unwrap() else {
        panic!("timed out barrier must remain queued");
    };
    let PreferenceWriterMessage::Updates(accepted) = receiver.recv().await.unwrap() else {
        panic!("recovery must accept new updates");
    };
    assert_eq!(accepted, newer);

    let (result, ()) = tokio::join!(runtime.shutdown(), async {
        let PreferenceWriterMessage::Flush(completion) = receiver.recv().await.unwrap() else {
            panic!("retry must enqueue a new flush barrier");
        };
        // 旧屏障晚到的成功结果不得替代新屏障，也不得关闭恢复期间的新写入。
        let _ = stale_completion.send(Some(true));
        completion.send(Some(true)).unwrap();
    });
    result.unwrap();
}
