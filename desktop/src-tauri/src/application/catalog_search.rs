use crate::application::error::AppError;
use crate::{
    domain::search::{SearchOccurrencesPage, TaskSearchInput, TaskSearchPage, TaskSearchResult},
    infrastructure::local_catalog::{LocalCatalog, sidebar::map_task},
};
use futures_util::{StreamExt, TryStreamExt, stream};
use serde_json::{Value, json};
use std::{collections::BTreeSet, future::Future, sync::Mutex};

fn invalid() -> AppError {
    AppError::CodexRequestFailed
}

/// 与共享 CatalogSearchService 使用相同目录契约、游标身份和四路并发预算。
pub(super) async fn search<F, R>(
    catalog: &LocalCatalog,
    input: TaskSearchInput,
    occurrences: F,
) -> Result<TaskSearchPage, AppError>
where
    F: Fn(Value, String) -> R,
    R: Future<Output = Result<SearchOccurrencesPage, AppError>>,
{
    let mut current = input;
    loop {
        let page = search_page(catalog, current.clone(), &occurrences).await?;
        if !page.data.is_empty() || page.unavailable_engines.is_some() || page.next_cursor.is_none()
        {
            return Ok(page);
        }
        // 跳过无全文命中的候选页；页面预算不意味着可以丢弃更早任务。
        if page.next_cursor == current.cursor {
            return Err(invalid());
        }
        current.cursor = page.next_cursor;
    }
}

async fn search_page<F, R>(
    catalog: &LocalCatalog,
    input: TaskSearchInput,
    occurrences: F,
) -> Result<TaskSearchPage, AppError>
where
    F: Fn(Value, String) -> R,
    R: Future<Output = Result<SearchOccurrencesPage, AppError>>,
{
    let query = input.query.trim();
    let kind = input.kind.as_deref().unwrap_or("history");
    let engines = input.engines.as_deref().unwrap_or("codex,claude");
    if query.is_empty()
        || query.encode_utf16().count() > 1024
        || !matches!(kind, "tasks" | "history")
        || !matches!(engines, "codex" | "claude" | "codex,claude")
    {
        return Err(invalid());
    }
    let mut params = json!({"archived":input.archived,"limit":if kind == "tasks" {30}else{10},"providers":engines.split(',').collect::<Vec<_>>()});
    if kind == "tasks" {
        params["searchTerm"] = json!(query);
    }
    if let Some(cursor) = &input.cursor {
        if cursor.len() > 8192 {
            return Err(invalid());
        }
        let cursor: Value = serde_json::from_str(cursor).map_err(|_| invalid())?;
        if cursor["version"] != 1
            || cursor["query"] != input.query
            || cursor["kind"] != kind
            || cursor["archived"] != input.archived
            || cursor["engines"] != engines
            || !cursor["catalog"].is_string()
        {
            return Err(invalid());
        }
        params["cursor"] = cursor["catalog"].clone();
    }
    let page = catalog.call("task.list", params).await?;
    let tasks = page["data"].as_array().ok_or_else(invalid)?;
    let unavailable = Mutex::new(BTreeSet::new());
    let data = stream::iter(tasks.iter().cloned())
        .map(|task| {
            let occurrences = &occurrences;
            let unavailable = &unavailable;
            async move {
                let metadata = map_task(&task)?;
                if kind == "tasks" {
                    return Ok(Some(TaskSearchResult {
                        task: metadata,
                        snippet: String::new(),
                        occurrence: None,
                    }));
                }
                let engine = task["provider"].as_str().ok_or_else(invalid)?.to_owned();
                let occurrence = match occurrences(task, query.to_owned()).await {
                    Ok(page) => page.data.into_iter().next(),
                    Err(AppError::RequestCancelled) => return Err(AppError::RequestCancelled),
                    Err(_) => {
                        unavailable.lock().map_err(|_| invalid())?.insert(engine);
                        None
                    }
                };
                Ok::<_, AppError>(occurrence.map(|hit| TaskSearchResult {
                    task: metadata,
                    snippet: hit.snippet.clone(),
                    occurrence: Some(hit),
                }))
            }
        })
        .buffered(4)
        .try_collect::<Vec<_>>()
        .await?
        .into_iter()
        .flatten()
        .collect();
    Ok(TaskSearchPage {
        data,
        unavailable_engines: {
            let engines = unavailable.into_inner().map_err(|_| invalid())?;
            (!engines.is_empty()).then(|| engines.into_iter().collect())
        },
        next_cursor: page["nextCursor"].as_str().map(|cursor| json!({"version":1,"query":input.query,"kind":kind,"archived":input.archived,"engines":engines,"catalog":cursor}).to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(kind: &str, engines: Option<&str>) -> TaskSearchInput {
        TaskSearchInput {
            query: "搜索".into(),
            kind: Some(kind.into()),
            engines: engines.map(str::to_owned),
            archived: false,
            cursor: None,
        }
    }

    async fn populate(catalog: &LocalCatalog) {
        for (id, provider, time) in [
            ("codex-new", "codex", 3),
            ("claude", "claude", 2),
            ("codex-old", "codex", 1),
        ] {
            catalog.call("task.put", json!({"id":id,"provider":provider,"updatedAt":time,"projectId":null,"title":"搜索本地标题","cwd":"/tmp","sessionId":id,"pinned":true,"archived":false,"status":"idle"})).await.unwrap();
        }
    }

    #[tokio::test]
    async fn titles_should_follow_selected_engines_without_runtime_calls() {
        let root = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(root.path()).unwrap();
        populate(&catalog).await;
        let page = search(&catalog, input("tasks", Some("claude")), |_, _| async {
            panic!("title search must not call a runtime")
        })
        .await
        .unwrap();
        assert_eq!(
            page.data
                .iter()
                .map(|hit| hit.task.id.as_str())
                .collect::<Vec<_>>(),
            ["claude"]
        );
        let both = search(&catalog, input("tasks", None), |_, _| async {
            panic!("title search must not call a runtime")
        })
        .await
        .unwrap();
        assert_eq!(
            both.data
                .iter()
                .map(|hit| hit.task.id.as_str())
                .collect::<Vec<_>>(),
            ["codex-new", "claude", "codex-old"]
        );
    }

    #[tokio::test]
    async fn history_should_preserve_healthy_engine_hits_and_report_partial_failures() {
        let root = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(root.path()).unwrap();
        populate(&catalog).await;
        let page = search(&catalog, input("history", None), |task, _| async move {
            if task["provider"] == "codex" { return Err(AppError::CodexRuntimeUnavailable); }
            Ok(serde_json::from_value(json!({"data":[{"itemId":"message","turnId":"turn","turnCursor":"anchor","snippet":"搜索","snippetMatchRange":{"start":0,"end":2}}],"nextCursor":null})).unwrap())
        }).await.unwrap();
        assert_eq!(page.data[0].task.id, "claude");
        assert_eq!(page.unavailable_engines, Some(vec!["codex".into()]));
    }

    #[tokio::test]
    async fn cursor_should_be_bound_to_engines_and_search_should_skip_empty_candidate_pages() {
        let root = tempfile::tempdir().unwrap();
        let catalog = LocalCatalog::at(root.path()).unwrap();
        for n in 0..11 {
            catalog.call("task.put", json!({"id":format!("task-{n}"),"provider":"claude","updatedAt":n,"projectId":null,"title":"搜索","cwd":"/tmp","sessionId":null,"pinned":false,"archived":false,"status":"idle"})).await.unwrap();
        }
        let empty = |_, _| async {
            Ok(SearchOccurrencesPage {
                data: vec![],
                next_cursor: None,
            })
        };
        let hit = || {
            serde_json::from_value::<SearchOccurrencesPage>(json!({"data":[{"itemId":"message","turnId":"turn","turnCursor":"anchor","snippet":"搜索","snippetMatchRange":{"start":0,"end":2}}],"nextCursor":null})).unwrap()
        };
        let page = search(
            &catalog,
            input("history", Some("claude")),
            |task, _| async move {
                if task["id"] == "task-0" {
                    Ok(hit())
                } else {
                    empty(task, String::new()).await
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(page.data[0].task.id, "task-0");
        assert!(page.next_cursor.is_none());
        let first = search(&catalog, input("history", Some("claude")), |_, _| async {
            Ok(hit())
        })
        .await
        .unwrap();
        assert!(first.next_cursor.is_some());
        let mut next = input("history", Some("codex"));
        next.cursor = first.next_cursor;
        assert!(search(&catalog, next, empty).await.is_err());
        for invalid in ["", "unknown", "claude,codex"] {
            assert!(
                search(&catalog, input("history", Some(invalid)), empty)
                    .await
                    .is_err()
            );
        }
    }
}
