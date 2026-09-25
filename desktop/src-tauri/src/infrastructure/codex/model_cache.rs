use std::{
    future::Future,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use serde_json::Value;
use tokio::{sync::Mutex, time::Instant};

use super::connection::ConnectionError;

const MODEL_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Default)]
pub(super) struct ModelCatalogCache {
    generation: AtomicU64,
    page: Mutex<Option<CachedModels>>,
}

struct CachedModels {
    generation: u64,
    loaded_at: Instant,
    value: Value,
}

impl ModelCatalogCache {
    pub(super) fn changing_for_request(&self, method: &str) -> Option<ModelCatalogChange<'_>> {
        if !matches!(
            method,
            "config/value/write"
                | "config/batchWrite"
                | "account/login/start"
                | "account/login/cancel"
                | "account/logout"
        ) {
            return None;
        }
        self.invalidate();
        Some(ModelCatalogChange(self))
    }

    pub(super) fn invalidate(&self) {
        // 通知读取不能等待正在请求模型的任务，否则会阻塞 JSONL 响应并产生死锁。
        self.generation.fetch_add(1, Ordering::AcqRel);
    }

    pub(super) async fn get_or_load<F>(
        &self,
        load: impl FnOnce() -> F,
    ) -> Result<Value, ConnectionError>
    where
        F: Future<Output = Result<Value, ConnectionError>>,
    {
        // 连接内只保留一份有界目录，并串行化首次读取，WebView 重建不影响缓存。
        let mut page = self.page.lock().await;
        let generation = self.generation.load(Ordering::Acquire);
        if let Some(cached) = page.as_ref()
            && cached.generation == generation
            && cached.loaded_at.elapsed() < MODEL_CACHE_TTL
        {
            return Ok(cached.value.clone());
        }
        let value = load().await?;
        // 查询期间账号或配置已变化时，旧结果不能重新填入有效缓存。
        if self.generation.load(Ordering::Acquire) == generation {
            *page = Some(CachedModels {
                generation,
                loaded_at: Instant::now(),
                value: value.clone(),
            });
        }
        Ok(value)
    }
}

pub(super) struct ModelCatalogChange<'a>(&'a ModelCatalogCache);

impl Drop for ModelCatalogChange<'_> {
    fn drop(&mut self) {
        // 变更开始和结束均失效，覆盖并发读取、失败以及调用方取消的情况。
        self.0.invalidate();
    }
}

#[cfg(test)]
#[path = "model_cache_unit_tests.rs"]
mod tests;
