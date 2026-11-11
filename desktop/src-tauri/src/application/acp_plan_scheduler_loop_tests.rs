use super::*;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicI64, AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::sync::Notify;

async fn seed(store: &LocalCatalog, id: &str, at: i64) {
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/acp-scheduled-plan-definition.json"
    ))
    .unwrap();
    definition["enabled"] = json!(true);
    definition["schedule"] = json!({"type":"once","atUnixMs":at});
    store.call("acp.plan.set",json!({"source":"desktop","scheduleId":id,"expectedRevision":0,"definition":definition})).await.unwrap();
    store.call("acp.plan.arm",json!({"source":"desktop","scheduleId":id,"expectedRevision":1,"expectedStateRevision":0,"nextRunAt":at})).await.unwrap();
}

#[tokio::test]
async fn acp_scheduler_loop_should_wait_for_inflight_and_leave_remaining_claims() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    seed(&store, "a", 10).await;
    seed(&store, "b", 10).await;
    let stop = CancellationToken::new();
    let wake = Notify::new();
    let entered = Arc::new(Notify::new());
    let gate = Arc::new(Notify::new());
    let count = Arc::new(AtomicUsize::new(0));
    let signal = entered.clone();
    let wait = gate.clone();
    let done = count.clone();
    let execute = move |_: String, _: String| {
        let signal = signal.clone();
        let wait = wait.clone();
        let done = done.clone();
        async move {
            signal.notify_one();
            wait.notified().await;
            done.fetch_add(1, Ordering::SeqCst);
            Ok(Value::Null)
        }
    };
    let mut running = Box::pin(run(&store, execute, &wake, &stop, || 10, |_| {}));
    tokio::select! {biased;
     result=&mut running=>panic!("loop stopped before execution: {result:?}"),
     _=entered.notified()=>{},
     _=tokio::time::sleep(Duration::from_secs(3))=>panic!("loop did not execute"),
    }
    stop.cancel();
    wake.notify_one();
    tokio::select! {biased;
     _=&mut running=>panic!("stop interrupted inflight execution"),
     _=tokio::task::yield_now()=>{},
    }
    assert_eq!(count.load(Ordering::SeqCst), 0);
    gate.notify_one();
    tokio::time::timeout(Duration::from_secs(3), running)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert_eq!(
        store
            .call("acp.plan.active", json!({"source":"desktop","limit":100}))
            .await
            .unwrap()["data"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn acp_scheduler_loop_should_wake_future_cursor_without_waiting_for_timer() {
    let root = tempfile::tempdir().unwrap();
    let store = LocalCatalog::at(root.path()).unwrap();
    seed(&store, "plan", 1000000).await;
    let stop = CancellationToken::new();
    let wake = Notify::new();
    let idle = Notify::new();
    let time = AtomicI64::new(100);
    let reads = AtomicUsize::new(0);
    let count = AtomicUsize::new(0);
    let execute = |_: String, _: String| async {
        count.fetch_add(1, Ordering::SeqCst);
        stop.cancel();
        Ok(Value::Null)
    };
    let clock = || {
        if reads.fetch_add(1, Ordering::SeqCst) == 1 {
            idle.notify_one();
        }
        time.load(Ordering::SeqCst)
    };
    let control = async {
        idle.notified().await;
        time.store(1000000, Ordering::SeqCst);
        wake.notify_one();
    };
    tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(run(&store, execute, &wake, &stop, clock, |_| {}), control)
    })
    .await
    .unwrap()
    .0
    .unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 1);
}
