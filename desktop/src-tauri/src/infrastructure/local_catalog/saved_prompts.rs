use super::{CatalogError, db_error, string};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde_json::{Value, json};
use std::sync::OnceLock;

fn sql() -> Result<&'static Value, CatalogError> {
    static SQL: OnceLock<Value> = OnceLock::new();
    if let Some(value) = SQL.get() {
        return Ok(value);
    }
    let value = serde_json::from_str(include_str!(
        "../../../../../packages/protocol/src/saved-prompts-sql.json"
    ))
    .map_err(|_| CatalogError::InvalidMessage)?;
    Ok(SQL.get_or_init(|| value))
}
pub(super) fn initialize(db: &Connection) -> Result<(), CatalogError> {
    db.execute_batch(string(sql()?, "schema")?)
        .map_err(db_error)
}
fn encode(prompt: &Value) -> Result<String, CatalogError> {
    let id = string(prompt, "id")?;
    let name = string(prompt, "name")?.trim();
    let content = string(prompt, "content")?;
    if id.is_empty()
        || id.encode_utf16().count() > 200
        || name.is_empty()
        || name.encode_utf16().count() > 80
        || content.trim().is_empty()
        || content.encode_utf16().count() > 20000
        || prompt
            .get("projectId")
            .is_some_and(|v| v.as_str().is_none_or(|s| s.trim().is_empty()))
    {
        return Err(CatalogError::InvalidMessage);
    }
    let mut value = json!({"id":id,"name":name,"content":content,"nameKey":name.to_lowercase()});
    if let Some(project) = prompt.get("projectId") {
        value["projectId"] = project.clone();
    }
    Ok(value.to_string())
}
/// 与 Web Worker 使用同一份 SQL；短写事务避免跨进程读改写覆盖和迁移后重复导入。
pub(super) fn execute(db: &mut Connection, input: &Value) -> Result<Value, CatalogError> {
    let sql = sql()?;
    let transaction = db
        .transaction_with_behavior(if input["action"] == "list" {
            TransactionBehavior::Deferred
        } else {
            TransactionBehavior::Immediate
        })
        .map_err(db_error)?;
    match string(input, "action")? {
        "save" => {
            let prompt = encode(&input["prompt"])?;
            let duplicate = transaction
                .query_row(string(sql, "duplicate")?, [&prompt], |_| Ok(true))
                .optional()
                .map_err(db_error)?
                .unwrap_or(false);
            if duplicate {
                return Err(CatalogError::DuplicatePrompt);
            }
            transaction
                .execute(string(sql, "save")?, [&prompt])
                .map_err(db_error)?;
            transaction
                .execute(string(sql, "receipt")?, [&prompt])
                .map_err(db_error)?;
        }
        "import" => {
            let prompts = input["prompts"]
                .as_array()
                .filter(|v| v.len() <= 1000)
                .ok_or(CatalogError::InvalidMessage)?;
            for entry in prompts {
                let prompt = encode(entry)?;
                if transaction
                    .execute(string(sql, "receipt")?, [&prompt])
                    .map_err(db_error)?
                    > 0
                {
                    transaction
                        .execute(string(sql, "save")?, [&prompt])
                        .map_err(db_error)?;
                }
            }
        }
        "remove" => {
            if string(input, "id")?.is_empty() {
                return Err(CatalogError::InvalidMessage);
            }
            let payload = input.to_string();
            transaction
                .execute(string(sql, "receipt")?, [&payload])
                .map_err(db_error)?;
            transaction
                .execute(string(sql, "remove")?, [&payload])
                .map_err(db_error)?;
        }
        "list" => {}
        _ => return Err(CatalogError::InvalidMessage),
    }
    let rows = transaction
        .prepare_cached(string(sql, "list")?)
        .map_err(db_error)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    let values = rows
        .iter()
        .map(|row| serde_json::from_str::<Value>(row).map_err(|_| CatalogError::InvalidMessage))
        .collect::<Result<Vec<_>, _>>()?;
    transaction.commit().map_err(db_error)?;
    Ok(json!(values))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::local_catalog::LocalCatalog;
    #[tokio::test]
    async fn shares_prompts_and_does_not_resurrect_deleted_imports() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalCatalog::at(directory.path()).unwrap();
        let prompt = json!({"id":"old","name":"检查","content":"正文"});
        assert_eq!(
            store
                .call(
                    "prompts.sync",
                    json!({"action":"import","prompts":[prompt]})
                )
                .await
                .unwrap(),
            json!([prompt])
        );
        store
            .call("prompts.sync", json!({"action":"remove","id":"old"}))
            .await
            .unwrap();
        assert_eq!(
            store
                .call(
                    "prompts.sync",
                    json!({"action":"import","prompts":[prompt]})
                )
                .await
                .unwrap(),
            json!([])
        );
    }
}
