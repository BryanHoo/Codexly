use serde_json::{Map, Value, json};

use super::{ConnectionError, PendingServerRequest, required_string};

pub(super) fn response(
    pending: &PendingServerRequest,
    resolution: &Map<String, Value>,
) -> Result<Value, ConnectionError> {
    let scope = required_string(resolution, "scope")?;
    if !matches!(scope, "turn" | "session") {
        return Err(ConnectionError::InvalidMessage);
    }
    let granted = resolution
        .get("grantedPermissions")
        .and_then(Value::as_array)
        .ok_or(ConnectionError::InvalidMessage)?;
    if granted.len() > 2 {
        return Err(ConnectionError::InvalidMessage);
    }
    let native = pending
        .native_permissions
        .as_ref()
        .and_then(Value::as_object)
        .ok_or(ConnectionError::InvalidMessage)?;
    let mut permissions = Map::new();
    // 权限只能取自原生请求；非法类别不能静默丢弃或通过重复项扩大处理量。
    for category in granted {
        let key = match category.as_str() {
            Some("network") => "network",
            Some("file_system") => "fileSystem",
            _ => return Err(ConnectionError::InvalidMessage),
        };
        if permissions.contains_key(key) {
            return Err(ConnectionError::InvalidMessage);
        }
        let value = native
            .get(key)
            .filter(|value| !value.is_null())
            .ok_or(ConnectionError::InvalidMessage)?;
        permissions.insert(key.to_owned(), value.clone());
    }
    // 空集合表示不授予任何权限，仍需保留合法的作用域。
    Ok(json!({"permissions": permissions, "scope": scope}))
}

#[cfg(test)]
mod tests {
    use super::super::{PendingServerRequest, response_for_resolution};
    use serde_json::{Value, json};

    fn pending() -> PendingServerRequest {
        PendingServerRequest {
            rpc_id: 9,
            method: "item/permissions/requestApproval".to_owned(),
            request: json!({"type": "permissions_approval"}),
            native_permissions: Some(json!({
                "network": {"enabled": true},
                "fileSystem": {"read": ["/tmp/read"], "write": ["/tmp/write"]}
            })),
            deny_decision: "decline",
        }
    }

    #[test]
    fn permissions_should_reject_invalid_categories() {
        for granted in [
            json!([null]),
            json!([1]),
            json!([true]),
            json!([{}]),
            json!(["network", "network"]),
            json!(["file_system", "file_system"]),
            json!(["network", "file_system", "network"]),
            json!(["unknown"]),
        ] {
            assert!(
                response_for_resolution(
                    &pending(),
                    &json!({
                        "grantedPermissions": granted, "scope": "turn"
                    })
                )
                .is_err(),
                "invalid category accepted: {granted}"
            );
        }
    }

    #[test]
    fn permissions_should_reject_unknown_scope() {
        for scope in [json!("forever"), json!(""), Value::Null, json!(true)] {
            assert!(
                response_for_resolution(
                    &pending(),
                    &json!({
                        "grantedPermissions": [], "scope": scope
                    })
                )
                .is_err(),
                "invalid scope accepted: {scope}"
            );
        }
    }

    #[test]
    fn permissions_should_only_return_selected_native_profiles() {
        let pending = pending();
        for scope in ["turn", "session"] {
            for (granted, expected) in [
                (json!([]), json!({})),
                (json!(["network"]), json!({"network": {"enabled": true}})),
                (
                    json!(["file_system"]),
                    json!({"fileSystem": {"read": ["/tmp/read"], "write": ["/tmp/write"]}}),
                ),
                (
                    json!(["file_system", "network"]),
                    pending.native_permissions.clone().unwrap(),
                ),
            ] {
                assert_eq!(
                    response_for_resolution(
                        &pending,
                        &json!({
                            "grantedPermissions": granted, "scope": scope
                        })
                    )
                    .unwrap(),
                    json!({"permissions": expected, "scope": scope})
                );
            }
        }
    }

    #[test]
    fn permissions_should_reject_unrequested_profile() {
        let mut pending = pending();
        for native in [json!({}), json!({"network": null})] {
            pending.native_permissions = Some(native);
            assert!(
                response_for_resolution(
                    &pending,
                    &json!({
                        "grantedPermissions": ["network"], "scope": "turn"
                    })
                )
                .is_err()
            );
        }
    }
}
