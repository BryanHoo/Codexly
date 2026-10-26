use super::{AppServerConnection, ConnectionError};
use crate::infrastructure::local_catalog::LocalCatalog;
use serde_json::{Value, json};
use std::{collections::HashMap, time::Duration};

const LOCAL_TITLE_UPDATED_METHOD: &str = "codeagent/taskTitleUpdated";

pub(super) fn thread(task: &Value, mut native: Value) -> Value {
    if !native.is_object() {
        native = json!({});
    }
    for key in ["id", "projectId", "cwd", "updatedAt"] {
        native[key] = task[key].clone();
    }
    // 原生协议秒数为整数，SQLite 内部仍保留亚秒精度排序。
    native["updatedAt"] = json!(task["updatedAt"].as_f64().unwrap_or_default() as i64);
    native["name"] = if task["title"] == "" {
        Value::Null
    } else {
        task["title"].clone()
    };
    native["preview"] = if task["title"] == "" {
        json!(task["preview"].as_str().unwrap_or_default())
    } else {
        task["title"].clone()
    };
    if native.get("status").is_none() {
        native["status"] = json!({"type":task["status"]});
    }
    native["section"] = if task["pinned"] == true {
        json!({"id":"01984de2-8f74-7c91-a3b2-5c5e937cf318","name":"Pinned","appearance":null})
    } else {
        Value::Null
    };
    native
}
pub(super) fn translate(value: &mut Value, ids: &HashMap<String, String>, key: &str) {
    match value {
        Value::Array(values) => {
            for value in values {
                translate(value, ids, key)
            }
        }
        Value::Object(object) => {
            let is_thread = key == "thread" || object.contains_key("cwd");
            for (field, value) in object {
                let reference = matches!(
                    field.as_str(),
                    "threadId"
                        | "thread_id"
                        | "parentThreadId"
                        | "reviewThreadId"
                        | "agentThreadId"
                        | "senderThreadId"
                        | "receiverThreadId"
                ) || (field == "id" && is_thread);
                if reference {
                    if let Some(id) = value.as_str().and_then(|id| ids.get(id)) {
                        *value = json!(id);
                    }
                } else if !value.is_string() {
                    translate(value, ids, field);
                }
            }
        }
        Value::String(id) if key.ends_with("ThreadIds") => {
            if let Some(mapped) = ids.get(id) {
                *id = mapped.clone();
            }
        }
        _ => {}
    }
}
impl AppServerConnection {
    pub(super) fn remember_catalog_task(&self, task: &Value) -> Result<(), ConnectionError> {
        if task["provider"] != "codex" {
            return Ok(());
        }
        if let (Some(id), Some(native)) = (task["id"].as_str(), task["sessionId"].as_str()) {
            self.catalog_ids
                .lock()
                .map_err(|_| ConnectionError::StateUnavailable)?
                .insert(id.to_owned(), native.to_owned());
            self.catalog_native_ids
                .lock()
                .map_err(|_| ConnectionError::StateUnavailable)?
                .insert(native.to_owned(), id.to_owned());
        }
        Ok(())
    }
    pub async fn translate_catalog_message(
        &self,
        mut message: super::ServerMessage,
    ) -> Result<Option<super::ServerMessage>, ConnectionError> {
        if self.catalog.is_none() {
            return Ok(Some(message));
        }
        // 本地落盘事件已使用应用任务 ID，直接进入公共映射；上游管理事件仍须屏蔽。
        if message.method == LOCAL_TITLE_UPDATED_METHOD {
            message.method = "thread/name/updated".to_owned();
            return Ok(Some(message));
        }
        if matches!(
            message.method.as_str(),
            "thread/name/updated" | "thread/archived" | "thread/unarchived" | "thread/deleted"
        ) {
            return Ok(None);
        }
        let mut params: Value = serde_json::from_str(message.params.get())
            .map_err(|_| ConnectionError::InvalidMessage)?;
        {
            let ids = self
                .catalog_native_ids
                .lock()
                .map_err(|_| ConnectionError::StateUnavailable)?;
            translate(&mut params, &ids, "");
        }
        if message.method == "thread/tokenUsage/updated"
            && let Some(catalog) = self.catalog.clone()
            && let Some(id) = params["threadId"].as_str()
        {
            let source = self
                .catalog_ids
                .lock()
                .map_err(|_| ConnectionError::StateUnavailable)?
                .get(id)
                .cloned();
            if let Some(source) = source {
                let sample = json!({"taskId":id,"source":source,"timestamp":chrono::Utc::now().to_rfc3339(),"tokenUsage":params["tokenUsage"]});
                catalog.enqueue_codex_usage(sample);
            }
        }
        if message.method == "thread/status/changed"
            && let Some(catalog) = &self.catalog
            && params["threadId"].is_string()
        {
            let id = params["threadId"].as_str().unwrap_or_default();
            let known = self
                .catalog_ids
                .lock()
                .map_err(|_| ConnectionError::StateUnavailable)?
                .contains_key(id);
            if known {
                catalog
                    .call(
                        "task.patch",
                        json!({"id":id,"status":params["status"]["type"]}),
                    )
                    .await?;
            }
        }
        message.params = serde_json::value::to_raw_value(&params)
            .map_err(|_| ConnectionError::InvalidMessage)?;
        Ok(Some(message))
    }
    pub(super) async fn catalog_request(
        &self,
        catalog: &LocalCatalog,
        method: &str,
        mut params: Value,
        timeout: Duration,
    ) -> Result<Value, ConnectionError> {
        if method == "thread/start" && params["ephemeral"] != true {
            let task = json!({"id":format!("task-{}",uuid::Uuid::new_v4()),"projectId":params["projectId"],"title":"","cwd":params["cwd"],"provider":"codex","sessionId":null,"updatedAt":chrono::Utc::now().timestamp_millis() as f64/1000.0,"pinned":false,"archived":false,"status":"notLoaded"});
            catalog.call("task.put", task.clone()).await?;
            let mut value = thread(&task, Value::Null);
            value["historyMode"] = json!("paginated");
            return Ok(json!({"thread":value}));
        }
        if method.starts_with("project/") {
            return self.catalog_project_request(catalog, method, params).await;
        }
        if method == "thread/list" {
            let mut query = params.clone();
            query["pinned"] = json!(params["sectionId"].is_string());
            let mut page = catalog.call("task.list", query).await?;
            if let Some(data) = page["data"].as_array_mut() {
                for task in data {
                    *task = thread(task, Value::Null);
                }
            }
            return Ok(page);
        }
        let id = params["threadId"].as_str().map(str::to_owned);
        let mut task = if let Some(id) = &id {
            catalog.call("task.read", json!({"id":id})).await?
        } else {
            Value::Null
        };
        if !task.is_null() {
            if task["provider"] != "codex" {
                return Err(ConnectionError::InvalidMessage);
            }
            self.remember_catalog_task(&task)?;
            match method {
                "catalog/task/read" => return Ok(json!({"thread":thread(&task,Value::Null)})),
                "thread/name/set" => {
                    let updated = catalog
                        .call("task.patch", json!({"id":id,"title":params["name"]}))
                        .await?;
                    // 与 Web 适配器一致：仅在持久化成功后通知左栏，使用规范化后的实际名称。
                    // 复用事实流的字节预算与背压，不新增前端订阅、轮询或引擎请求。
                    self.catalog_messages
                        .send(super::ServerMessage {
                            id: None,
                            method: LOCAL_TITLE_UPDATED_METHOD.to_owned(),
                            params: serde_json::value::to_raw_value(&json!({
                                "threadId": updated["id"], "threadName": updated["title"],
                            }))?,
                        })
                        .await
                        .map_err(|_| ConnectionError::ConnectionClosed)?;
                    return Ok(json!({}));
                }
                "thread/section/move" => {
                    catalog
                        .call(
                            "task.patch",
                            json!({"id":id,"pinned":!params["sectionId"].is_null()}),
                        )
                        .await?;
                    return Ok(json!({}));
                }
                "thread/archive" | "thread/unarchive" => {
                    let task = catalog
                        .call(
                            "task.patch",
                            json!({"id":id,"archived":method=="thread/archive"}),
                        )
                        .await?;
                    return Ok(if method == "thread/archive" {
                        json!({})
                    } else {
                        json!({"thread":thread(&task,Value::Null)})
                    });
                }
                "thread/delete" => {
                    catalog.call("task.remove", json!({"id":id})).await?;
                    return Ok(json!({}));
                }
                _ => {}
            }
        }
        if method == "catalog/task/read"
            || (id.as_deref().is_some_and(|id| id.starts_with("task-"))
                && task.is_null()
                && method != "thread/unsubscribe")
        {
            return Err(ConnectionError::InvalidMessage);
        }
        if !task.is_null() && task["sessionId"].is_null() {
            match method {
                "thread/read" => {
                    let mut value = thread(&task, Value::Null);
                    value["historyMode"] = json!("paginated");
                    return Ok(json!({"thread":value}));
                }
                "thread/turns/list" | "thread/queue/list" => {
                    return Ok(json!({"data":[],"nextCursor":null,"backwardsCursor":null}));
                }
                "thread/goal/get" => return Ok(json!({"goal":null})),
                "thread/unsubscribe" => return Ok(json!({"status":"notLoaded"})),
                "thread/settings/update" => {
                    if params["cwd"].is_string() {
                        catalog
                            .call("task.patch", json!({"id":id,"cwd":params["cwd"]}))
                            .await?;
                    }
                    return Ok(json!({}));
                }
                _ => {}
            }
            if task["title"] == "" {
                self.pending_task_titles
                    .lock()
                    .map_err(|_| ConnectionError::StateUnavailable)?
                    .entry(id.clone().ok_or(ConnectionError::InvalidMessage)?)
                    .or_insert_with(|| task["cwd"].as_str().unwrap_or_default().to_owned());
            }
            let config = params
                .get("config")
                .cloned()
                // 首次 Turn 才物化原生线程，缺省配置也须沿用普通会话的热缓存策略。
                .unwrap_or_else(|| json!(super::conversation_commands::thread_config()));
            let mut started:Value=self.request_raw("thread/start",&json!({"cwd":task["cwd"],"runtimeWorkspaceRoots":[task["cwd"]],"historyMode":"paginated","config":config}),timeout).await?;
            task = catalog
                .call(
                    "task.patch",
                    json!({"id":id,"sessionId":started["thread"]["id"]}),
                )
                .await?;
            self.remember_catalog_task(&task)?;
            if method == "thread/resume" {
                started["thread"] = thread(&task, started["thread"].take());
                return Ok(started);
            }
        }
        let project_id = if method == "thread/fork" {
            task["projectId"].clone()
        } else {
            params["projectId"].clone()
        };
        let ephemeral = params["ephemeral"] == true;
        {
            let ids = self
                .catalog_ids
                .lock()
                .map_err(|_| ConnectionError::StateUnavailable)?;
            translate(&mut params, &ids, "");
        }
        if matches!(method, "thread/start" | "thread/fork")
            && let Some(object) = params.as_object_mut()
        {
            object.remove("projectId");
        }
        if !task.is_null() && method == "turn/start" {
            catalog.call("task.patch",json!({"id":id,"updatedAt":chrono::Utc::now().timestamp_millis() as f64/1000.0,"status":"active"})).await?;
        }
        let mut response: Value = match self.request_raw(method, &params, timeout).await {
            Err(ConnectionError::Request { message, .. })
                if method == "thread/resume"
                    && task["sessionId"].as_str().is_some_and(|id| {
                        message.contains(&format!("session {id} is archived"))
                    }) =>
            {
                // 归档标记属于本地管理；仅真正恢复执行时解封旧 Codex 会话。
                let _: Value = self
                    .request_raw(
                        "thread/unarchive",
                        &json!({"threadId":task["sessionId"]}),
                        timeout,
                    )
                    .await?;
                self.request_raw(method, &params, timeout).await?
            }
            Err(error) => {
                if !task.is_null() && method == "turn/start" {
                    catalog
                        .call("task.patch", json!({"id":id,"status":task["status"]}))
                        .await?;
                }
                return Err(error);
            }
            Ok(response) => response,
        };
        // 分叉会话可能在创建后绑定独立临时工作区；执行端成功后同步保存应用路径。
        if !task.is_null() && method == "thread/settings/update" && params["cwd"].is_string() {
            task = catalog
                .call("task.patch", json!({"id":id,"cwd":params["cwd"]}))
                .await?;
        }
        if matches!(method, "thread/start" | "thread/fork") && !ephemeral {
            let native = &response["thread"];
            let task = json!({"id":format!("task-{}",uuid::Uuid::new_v4()),"projectId":project_id,
                "title":native["name"].as_str().unwrap_or_default(),"cwd":native["cwd"],"provider":"codex","sessionId":native["id"],
                "updatedAt":native["updatedAt"],"pinned":false,"archived":false,"status":"idle"});
            catalog.call("task.put", task.clone()).await?;
            self.remember_catalog_task(&task)?;
            let current = catalog.call("task.read", json!({"id":task["id"]})).await?;
            response["thread"] = thread(&current, response["thread"].take());
            return Ok(response);
        }
        {
            let ids = self
                .catalog_native_ids
                .lock()
                .map_err(|_| ConnectionError::StateUnavailable)?;
            translate(&mut response, &ids, "");
        }
        if method == "thread/loaded/list"
            && let Some(values) = response["data"].as_array_mut()
        {
            let ids = self
                .catalog_native_ids
                .lock()
                .map_err(|_| ConnectionError::StateUnavailable)?;
            for value in values {
                if let Some(id) = value.as_str().and_then(|id| ids.get(id)) {
                    *value = json!(id);
                }
            }
        }
        if method == "thread/search"
            && let Some(values) = response["data"].as_array_mut()
        {
            let mut mapped = Vec::with_capacity(values.len());
            for mut value in std::mem::take(values) {
                let local = catalog
                    .call("task.read", json!({"id":value["thread"]["id"]}))
                    .await?;
                if !local.is_null() && (local["archived"] == true) == (params["archived"] == true) {
                    value["thread"] = thread(&local, value["thread"].take());
                    mapped.push(value);
                }
            }
            *values = mapped;
        }
        if !task.is_null() && response.get("thread").is_some() {
            let current = catalog.call("task.read", json!({"id":task["id"]})).await?;
            response["thread"] = thread(&current, response["thread"].take());
        }
        Ok(response)
    }
}

#[cfg(test)]
#[path = "local_catalog_bridge_tests.rs"]
mod tests;
