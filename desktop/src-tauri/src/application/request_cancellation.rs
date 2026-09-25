use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub(super) struct RequestCancellationRegistry {
    next_sequence: AtomicU64,
    requests: Arc<Mutex<HashMap<String, RequestCancellation>>>,
}

struct RequestCancellation {
    sequence: u64,
    token: CancellationToken,
}

struct RequestRegistration {
    request_id: String,
    requests: Arc<Mutex<HashMap<String, RequestCancellation>>>,
    sequence: u64,
    token: CancellationToken,
}

impl RequestCancellationRegistry {
    pub(super) async fn run<T, F>(&self, request_id: Option<&str>, task: F) -> Option<T>
    where
        F: Future<Output = T>,
    {
        let Some(request_id) = request_id else {
            return Some(task.await);
        };
        let registration = self.register(request_id);
        tokio::select! {
            biased;
            () = registration.token.cancelled() => None,
            output = task => Some(output),
        }
    }

    pub(super) fn cancel(&self, request_id: &str) -> bool {
        let requests = self
            .requests
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(request) = requests.get(request_id) else {
            return false;
        };
        request.token.cancel();
        true
    }

    fn register(&self, request_id: &str) -> RequestRegistration {
        let sequence = self.next_sequence.fetch_add(1, Ordering::Relaxed);
        let token = CancellationToken::new();
        self.requests
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(
                request_id.to_owned(),
                RequestCancellation {
                    sequence,
                    token: token.clone(),
                },
            );
        RequestRegistration {
            request_id: request_id.to_owned(),
            requests: Arc::clone(&self.requests),
            sequence,
            token,
        }
    }
}

impl Drop for RequestRegistration {
    fn drop(&mut self) {
        let mut requests = self
            .requests
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // 只清理自己的注册，避免极低概率的重复 requestId 删除更新的请求。
        if requests
            .get(&self.request_id)
            .is_some_and(|request| request.sequence == self.sequence)
        {
            requests.remove(&self.request_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::RequestCancellationRegistry;

    #[tokio::test]
    async fn cancellation_should_stop_and_remove_the_registered_request() {
        let registry = Arc::new(RequestCancellationRegistry::default());
        let running_registry = Arc::clone(&registry);
        let running = tokio::spawn(async move {
            running_registry
                .run(Some("request-a"), std::future::pending::<()>())
                .await
        });
        tokio::task::yield_now().await;

        assert!(registry.cancel("request-a"));
        assert_eq!(running.await.unwrap(), None);
        assert!(!registry.cancel("request-a"));
    }
}
