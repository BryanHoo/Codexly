use serde_yaml::{Mapping, Value};

const OPENCLAW_METADATA_KEYS: [&str; 3] = ["openclaw", "clawdbot", "clawdis"];

pub(crate) fn is_codex_compatible_skill(source: &str) -> bool {
    let Some(frontmatter) = extract_frontmatter(source) else {
        return false;
    };
    let Ok(document) = serde_yaml::from_str::<Value>(frontmatter) else {
        return false;
    };
    let Some(root) = document.as_mapping() else {
        return false;
    };
    if !["name", "description"].iter().all(|key| {
        mapping_value(root, key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    }) {
        return false;
    }

    // ClawHub 的展示元数据不影响 Codex；仅拦截会绑定 OpenClaw 运行时的声明。
    let Some(metadata) = mapping_value(root, "metadata").and_then(Value::as_mapping) else {
        return true;
    };
    !OPENCLAW_METADATA_KEYS.iter().any(|key| {
        mapping_value(metadata, key)
            .and_then(Value::as_mapping)
            .is_some_and(has_openclaw_runtime_dependency)
    })
}

fn extract_frontmatter(source: &str) -> Option<&str> {
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let remainder = source
        .strip_prefix("---\n")
        .or_else(|| source.strip_prefix("---\r\n"))?;
    let mut offset = 0;
    for line in remainder.split_inclusive('\n') {
        let content = line.trim_end_matches(['\r', '\n']);
        if content == "---" {
            return Some(&remainder[..offset]);
        }
        offset += line.len();
    }
    None
}

fn has_openclaw_runtime_dependency(metadata: &Mapping) -> bool {
    [
        "primaryEnv",
        "envVars",
        "install",
        "nix",
        "config",
        "skillKey",
    ]
    .iter()
    .any(|key| mapping_value(metadata, key).is_some_and(is_non_empty_value))
        || mapping_value(metadata, "always") == Some(&Value::Bool(true))
        || mapping_value(metadata, "requires")
            .and_then(Value::as_mapping)
            .is_some_and(|requires| {
                ["env", "bins", "anyBins", "config"]
                    .iter()
                    .any(|key| mapping_value(requires, key).is_some_and(is_non_empty_value))
            })
}

fn mapping_value<'a>(mapping: &'a Mapping, key: &str) -> Option<&'a Value> {
    mapping.get(Value::String(key.to_owned()))
}

fn is_non_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::String(value) => !value.trim().is_empty(),
        Value::Sequence(value) => !value.is_empty(),
        Value::Mapping(value) => !value.is_empty(),
        Value::Number(_) | Value::Tagged(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::is_codex_compatible_skill;

    #[test]
    fn accepts_portable_agent_skill_frontmatter() {
        let source = r#"---
name: code-review
description: Review code changes.
version: 1.0.0
---

# Code review
"#;

        assert!(is_codex_compatible_skill(source));
    }

    #[test]
    fn rejects_openclaw_runtime_metadata() {
        let source = r#"---
name: gateway-helper
description: Configure an OpenClaw gateway.
metadata:
  openclaw:
    config:
      gateway: true
---
"#;

        assert!(!is_codex_compatible_skill(source));
    }

    #[test]
    fn rejects_required_environment_variables_and_binaries() {
        for requirement in [
            "requires:\n      env: [API_TOKEN]",
            "requires:\n      bins: [gh]",
            "requires:\n      anyBins: [node, bun]",
            "requires:\n      config: [gateway]",
            "primaryEnv: API_TOKEN",
            "install:\n      - kind: node\n        package: demo",
        ] {
            let source = format!(
                "---\nname: incompatible\ndescription: Runtime-bound skill.\nmetadata:\n  openclaw:\n    {requirement}\n---\n"
            );
            assert!(
                !is_codex_compatible_skill(&source),
                "accepted {requirement}"
            );
        }
    }
}
