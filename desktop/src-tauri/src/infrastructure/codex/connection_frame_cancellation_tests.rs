use std::{future::Future, task::Poll};

use tokio::io::{AsyncWriteExt, duplex};

use super::*;

// 手动轮询到 Pending，确保半帧已被消费后才释放通知槽位，避免依赖调度或 sleep。
async fn poll_until_pending(mut future: Pin<&mut impl Future<Output = ()>>) {
    std::future::poll_fn(|cx| {
        assert!(
            future.as_mut().poll(cx).is_pending(),
            "reader exited unexpectedly"
        );
        Poll::Ready(())
    })
    .await;
}

async fn verify_partial_response(close_receiver: bool) {
    let (reader, mut writer) = duplex(4096);
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let (response_tx, mut response_rx) = oneshot::channel();
    pending.lock().unwrap().insert(1, response_tx);
    let (sender, mut receiver) = server_message_channel(1);
    let read = read_responses(reader, pending, sender, None, Arc::default(), 1);
    tokio::pin!(read);

    writer
        .write_all(
            b"{\"method\":\"test/event\",\"params\":{\"sequence\":0}}\n\
          {\"method\":\"test/event\",\"params\":{\"sequence\":1}}\n\
          {\"method\":\"test/event\",\"params\":{\"sequence\":2}}\n\
          {\"id\":1,",
        )
        .await
        .unwrap();
    poll_until_pending(read.as_mut()).await;

    if close_receiver {
        drop(receiver);
        poll_until_pending(read.as_mut()).await;
    } else {
        // 连续两次交付积压通知，覆盖 select! 重入及队列从非空变为空。
        for sequence in 0..3 {
            let message = receiver.try_recv().unwrap();
            assert_eq!(message.params.get(), format!("{{\"sequence\":{sequence}}}"));
            poll_until_pending(read.as_mut()).await;
        }
    }

    writer.write_all(b"\"result\":{}}\n").await.unwrap();
    poll_until_pending(read.as_mut()).await;
    assert_eq!(response_rx.try_recv().unwrap().unwrap().get(), "{}");
}

#[tokio::test]
async fn partial_response_should_survive_notification_delivery() {
    verify_partial_response(false).await;
}

#[tokio::test]
async fn partial_response_should_survive_notification_receiver_closure() {
    verify_partial_response(true).await;
}
