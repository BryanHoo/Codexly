use std::{future::Future, task::Poll};

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, duplex};
use tokio::time::timeout;

use super::*;

const REQUEST_TIMEOUT: Duration = Duration::from_millis(10);
const WATCHDOG: Duration = Duration::from_secs(1);

// 显式轮询到挂起点，确保取消发生在指定阶段，不依赖后台任务调度。
async fn poll_pending<T>(future: Pin<&mut impl Future<Output = T>>) {
    let mut future = future;
    std::future::poll_fn(|cx| {
        assert!(future.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
}

#[tokio::test]
async fn request_timeout_should_cover_writer_queue() {
    let (reader, _server) = duplex(1024);
    let connection = AppServerConnection::new(reader, tokio::io::sink());
    let _lock = connection.writer.lock().await;
    let result = timeout(
        WATCHDOG,
        connection.request::<_, Value>("test", &(), REQUEST_TIMEOUT),
    )
    .await;
    assert!(
        matches!(result, Ok(Err(ConnectionError::Timeout))),
        "{result:?}"
    );
    assert!(connection.pending.lock().unwrap().is_empty());
}

#[tokio::test]
async fn request_timeout_should_cover_blocked_write() {
    let (reader, _server) = duplex(1024);
    let (writer, _server_reader) = duplex(4);
    let connection = AppServerConnection::new(reader, writer);
    let result = timeout(
        WATCHDOG,
        connection.request::<_, Value>("test", &(), REQUEST_TIMEOUT),
    )
    .await;
    assert!(
        matches!(result, Ok(Err(ConnectionError::Timeout))),
        "{result:?}"
    );
    assert!(connection.pending.lock().unwrap().is_empty());
    assert!(matches!(
        connection.notify("test").await,
        Err(ConnectionError::ConnectionClosed)
    ));
}

#[tokio::test]
async fn cancelled_queued_request_should_remove_registration_and_preserve_writer() {
    let (reader, _server) = duplex(1024);
    let connection = AppServerConnection::new(reader, tokio::io::sink());
    let lock = connection.writer.lock().await;
    let mut request = Box::pin(connection.request::<_, Value>("test", &(), WATCHDOG));
    poll_pending(request.as_mut()).await;
    assert_eq!(connection.pending.lock().unwrap().len(), 1);
    drop(request);
    assert!(connection.pending.lock().unwrap().is_empty());
    drop(lock);
    connection.notify("test").await.unwrap();
}

#[tokio::test]
async fn cancelled_response_wait_should_remove_registration_and_preserve_writer() {
    let (reader, _server) = duplex(1024);
    let connection = AppServerConnection::new(reader, tokio::io::sink());
    let mut request = Box::pin(connection.request::<_, Value>("test", &(), WATCHDOG));
    poll_pending(request.as_mut()).await;
    drop(request);
    assert!(connection.pending.lock().unwrap().is_empty());
    connection.notify("test").await.unwrap();
}

#[tokio::test]
async fn cancelled_partial_write_should_close_connection_and_fail_other_requests() {
    let (reader, _server) = duplex(1024);
    let (writer, mut server_reader) = duplex(4);
    let connection = AppServerConnection::new(reader, writer);
    let (sender, receiver) = oneshot::channel();
    connection.pending.lock().unwrap().insert(100, sender);
    let mut request = Box::pin(connection.request::<_, Value>("test", &(), WATCHDOG));
    poll_pending(request.as_mut()).await;
    let mut prefix = [0; 4];
    server_reader.read_exact(&mut prefix).await.unwrap();
    drop(request);
    assert!(connection.pending.lock().unwrap().is_empty());
    assert!(matches!(
        receiver.await.unwrap(),
        Err(PendingError::ConnectionClosed)
    ));
    assert!(matches!(
        connection.notify("test").await,
        Err(ConnectionError::ConnectionClosed)
    ));
    assert_eq!(server_reader.read(&mut prefix).await.unwrap(), 0);
}

#[tokio::test]
async fn request_deadline_should_include_overload_backoff() {
    let (reader, mut server) = duplex(1024);
    let connection = AppServerConnection::new(reader, tokio::io::sink());
    let mut request =
        Box::pin(connection.request::<_, Value>("test", &(), Duration::from_millis(20)));
    poll_pending(request.as_mut()).await;
    server
        .write_all(
            format!(
                "{}\n",
                json!({"id":1,"error":{"code":-32001,"message":"busy"}})
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    // 成功响应在退避结束后、旧实现的第二次超时前到达，但已超过总预算。
    let responder = tokio::spawn(async move {
        sleep(Duration::from_millis(30)).await;
        let _ = server.write_all(b"{\"id\":2,\"result\":{}}\n").await;
    });
    let result = timeout(WATCHDOG, request).await;
    responder.abort();
    assert!(
        matches!(result, Ok(Err(ConnectionError::Timeout))),
        "{result:?}"
    );
}

struct BlockedFlush;

impl AsyncWrite for BlockedFlush {
    fn poll_write(
        self: Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
        bytes: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Poll::Ready(Ok(bytes.len()))
    }

    fn poll_flush(
        self: Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Poll::Pending
    }

    fn poll_shutdown(
        self: Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

#[tokio::test]
async fn cancelled_flush_should_close_connection() {
    let (reader, _server) = duplex(1024);
    let connection = AppServerConnection::new(reader, BlockedFlush);
    let mut request = Box::pin(connection.request::<_, Value>("test", &(), WATCHDOG));
    poll_pending(request.as_mut()).await;
    drop(request);
    let result = timeout(REQUEST_TIMEOUT, connection.respond(1, &())).await;
    assert!(
        matches!(result, Ok(Err(ConnectionError::ConnectionClosed))),
        "{result:?}"
    );
}

#[tokio::test]
async fn request_timeout_should_cover_flush() {
    let (reader, _server) = duplex(1024);
    let connection = AppServerConnection::new(reader, BlockedFlush);
    let result = timeout(
        WATCHDOG,
        connection.request::<_, Value>("test", &(), REQUEST_TIMEOUT),
    )
    .await;
    assert!(
        matches!(result, Ok(Err(ConnectionError::Timeout))),
        "{result:?}"
    );
}
