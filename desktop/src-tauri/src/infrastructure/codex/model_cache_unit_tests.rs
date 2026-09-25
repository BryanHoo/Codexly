use super::*;
use serde_json::json;

#[tokio::test]
async fn expired_models_should_be_loaded_again() {
    let cache = ModelCatalogCache::default();
    cache
        .get_or_load(|| async { Ok(json!("old")) })
        .await
        .unwrap();
    cache.page.lock().await.as_mut().unwrap().loaded_at = Instant::now() - MODEL_CACHE_TTL;

    assert_eq!(
        cache
            .get_or_load(|| async { Ok(json!("new")) })
            .await
            .unwrap(),
        json!("new")
    );
}

#[tokio::test]
async fn failed_load_should_allow_retry() {
    let cache = ModelCatalogCache::default();
    assert!(
        cache
            .get_or_load(|| async { Err(ConnectionError::Timeout) })
            .await
            .is_err()
    );
    assert_eq!(
        cache
            .get_or_load(|| async { Ok(json!("retry")) })
            .await
            .unwrap(),
        json!("retry")
    );
}

#[tokio::test]
async fn invalidation_during_loading_should_reject_the_old_cache_entry() {
    let cache = ModelCatalogCache::default();
    cache
        .get_or_load(|| async {
            cache.invalidate();
            Ok(json!("old"))
        })
        .await
        .unwrap();

    assert_eq!(
        cache
            .get_or_load(|| async { Ok(json!("new")) })
            .await
            .unwrap(),
        json!("new")
    );
}

#[tokio::test]
async fn provider_changes_should_invalidate_concurrent_reads_on_completion() {
    for method in [
        "config/value/write",
        "config/batchWrite",
        "account/login/start",
        "account/login/cancel",
        "account/logout",
    ] {
        let cache = ModelCatalogCache::default();
        cache
            .get_or_load(|| async { Ok(json!("before")) })
            .await
            .unwrap();
        let change = cache.changing_for_request(method).unwrap();
        assert_eq!(
            cache
                .get_or_load(|| async { Ok(json!("during")) })
                .await
                .unwrap(),
            json!("during")
        );
        drop(change);
        assert_eq!(
            cache
                .get_or_load(|| async { Ok(json!("after")) })
                .await
                .unwrap(),
            json!("after")
        );
    }
}

#[tokio::test]
async fn concurrent_readers_should_share_one_load() {
    let cache = ModelCatalogCache::default();
    let (first, second) = tokio::join!(
        cache.get_or_load(|| async {
            tokio::task::yield_now().await;
            Ok(json!("shared"))
        }),
        cache.get_or_load(|| async { panic!("concurrent reader must reuse the first load") }),
    );
    assert_eq!(first.unwrap(), second.unwrap());
}
