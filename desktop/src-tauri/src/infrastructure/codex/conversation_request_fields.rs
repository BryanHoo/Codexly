use serde_json::{Map, Value, json};

use super::connection::ConnectionError;

pub(super) fn map_permission_profile(
    profile: &Map<String, Value>,
) -> Result<Value, ConnectionError> {
    let file_system = profile
        .get("fileSystem")
        .filter(|value| !value.is_null())
        .map(|value| {
            let value = object(value)?;
            let entries = value
                .get("entries")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(map_permission_entry)
                .collect::<Result<Vec<_>, _>>()?;
            Ok::<Value, ConnectionError>(json!({
                "entries": entries,
                "globScanMaxDepth": optional(value, "globScanMaxDepth"),
                "read": optional(value, "read"),
                "write": optional(value, "write"),
            }))
        })
        .transpose()?;
    Ok(json!({
        "fileSystem": file_system,
        "network": optional(profile, "network"),
    }))
}

pub(super) fn map_mcp_fields(schema: &Value) -> Result<Vec<Value>, ConnectionError> {
    let schema = object(schema)?;
    let properties = object(
        schema
            .get("properties")
            .ok_or(ConnectionError::InvalidMessage)?,
    )?;
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    properties
        .iter()
        .map(|(id, value)| {
            let field = object(value)?;
            let identity = json!({
                "description": optional(field, "description"),
                "id": id,
                "required": required.iter().any(|value| value.as_str() == Some(id)),
                "title": field.get("title").and_then(Value::as_str).unwrap_or(id),
            });
            map_mcp_field(identity, field)
        })
        .collect()
}

fn map_mcp_field(
    mut identity: Value,
    field: &Map<String, Value>,
) -> Result<Value, ConnectionError> {
    let field_type = required_string(field, "type")?;
    let extra = match field_type {
        "boolean" => json!({
            "defaultValue": optional(field, "default"),
            "type": "boolean",
        }),
        "number" | "integer" => json!({
            "defaultValue": optional(field, "default"),
            "maximum": optional(field, "maximum"),
            "minimum": optional(field, "minimum"),
            "type": field_type,
        }),
        "string" => map_string_field(field)?,
        "array" => map_multi_select_field(field)?,
        _ => return Err(ConnectionError::InvalidMessage),
    };
    identity
        .as_object_mut()
        .ok_or(ConnectionError::InvalidMessage)?
        .extend(object(&extra)?.clone());
    Ok(identity)
}

fn map_string_field(field: &Map<String, Value>) -> Result<Value, ConnectionError> {
    if let Some(options) = map_options(field)? {
        return Ok(json!({
            "defaultValue": optional(field, "default"),
            "options": options,
            "type": "select",
        }));
    }
    Ok(json!({
        "defaultValue": optional(field, "default"),
        "format": optional(field, "format"),
        "maxLength": optional(field, "maxLength"),
        "minLength": optional(field, "minLength"),
        "type": "string",
    }))
}

fn map_multi_select_field(field: &Map<String, Value>) -> Result<Value, ConnectionError> {
    let items = object(field.get("items").ok_or(ConnectionError::InvalidMessage)?)?;
    let options = map_options(items)?.ok_or(ConnectionError::InvalidMessage)?;
    Ok(json!({
        "defaultValue": field.get("default").cloned().unwrap_or_else(|| json!([])),
        "maximum": optional(field, "maxItems"),
        "minimum": optional(field, "minItems"),
        "options": options,
        "type": "multi_select",
    }))
}

fn map_options(field: &Map<String, Value>) -> Result<Option<Vec<Value>>, ConnectionError> {
    if let Some(values) = field
        .get("oneOf")
        .or_else(|| field.get("anyOf"))
        .and_then(Value::as_array)
    {
        return values
            .iter()
            .map(|value| {
                let value = object(value)?;
                Ok(json!({
                    "label": required_string(value, "title")?,
                    "value": required_string(value, "const")?,
                }))
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some);
    }
    let Some(values) = field.get("enum").and_then(Value::as_array) else {
        return Ok(None);
    };
    let names = field.get("enumNames").and_then(Value::as_array);
    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let value = value.as_str().ok_or(ConnectionError::InvalidMessage)?;
            let label = names
                .and_then(|names| names.get(index))
                .and_then(Value::as_str)
                .unwrap_or(value);
            Ok(json!({"label": label, "value": value}))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

fn map_permission_entry(value: Value) -> Result<Value, ConnectionError> {
    let entry = object(&value)?;
    let path = object(entry.get("path").ok_or(ConnectionError::InvalidMessage)?)?;
    let public_path = match required_string(path, "type")? {
        "path" => json!({"type": "path", "value": required_string(path, "path")?}),
        "glob_pattern" => {
            json!({"type": "glob", "value": required_string(path, "pattern")?})
        }
        "special" => {
            let value = object(path.get("value").ok_or(ConnectionError::InvalidMessage)?)?;
            json!({
                "kind": required_string(value, "kind")?,
                "path": optional(value, "path"),
                "subpath": optional(value, "subpath"),
                "type": "special",
            })
        }
        _ => return Err(ConnectionError::InvalidMessage),
    };
    Ok(json!({
        "access": required_string(entry, "access")?,
        "path": public_path,
    }))
}

fn object(value: &Value) -> Result<&Map<String, Value>, ConnectionError> {
    value.as_object().ok_or(ConnectionError::InvalidMessage)
}

fn optional(params: &Map<String, Value>, key: &str) -> Value {
    params.get(key).cloned().unwrap_or(Value::Null)
}

fn required_string<'a>(
    params: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ConnectionError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidMessage)
}
