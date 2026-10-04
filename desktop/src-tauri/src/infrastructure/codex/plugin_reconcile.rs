use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{
    FutureExt,
    future::{BoxFuture, WeakShared},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::connection::{AppServerConnection, ConnectionError};

type ReconcileFuture = BoxFuture<'static, Result<PluginReconcileResult, Arc<ConnectionError>>>;

#[derive(Default)]
pub(super) struct PluginReconciler(Mutex<Option<WeakShared<ReconcileFuture>>>);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginReconcileResult {
    changed_plugins: Vec<ChangedPlugin>,
    failed_remote_plugin_ids: Vec<String>,
    failed_materialization_remote_plugin_ids: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedPlugin {
    id: String,
    has_apps: bool,
    has_hooks: bool,
    has_mcps: bool,
    has_skills: bool,
}

pub async fn reconcile_official_plugins(
    connection: Arc<AppServerConnection>,
) -> Result<PluginReconcileResult, Arc<ConnectionError>> {
    let request = {
        let mut pending = connection
            .plugin_reconciler
            .0
            .lock()
            .map_err(|_| Arc::new(ConnectionError::StateUnavailable))?;
        if let Some(request) = pending.as_ref().and_then(WeakShared::upgrade) {
            request
        } else {
            let runtime = Arc::clone(&connection);
            let request = async move {
                let result: PluginReconcileResult = runtime
                    .request(
                        "plugin/reconcile",
                        &json!({"reason": "codexly.refresh"}),
                        Duration::from_secs(30),
                    )
                    .await
                    .map_err(Arc::new)?;
                if result
                    .changed_plugins
                    .iter()
                    .any(|plugin| plugin.id.is_empty())
                {
                    return Err(Arc::new(ConnectionError::InvalidMessage));
                }
                Ok(result)
            }
            .boxed()
            .shared();
            // 只弱引用在途请求，避免连接与 Future 循环持有；完成、失败或取消后不复用变化结果。
            *pending = request.downgrade();
            request
        }
    };
    request.await
}
