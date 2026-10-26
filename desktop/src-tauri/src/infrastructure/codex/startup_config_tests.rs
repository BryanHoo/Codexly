use super::startup_config::{
    StartupConfigProbeError, build_startup_config_command, parse_startup_config,
};
use serde_json::{Value, json};
use std::ffi::OsStr;

fn samples() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/provider-codex/test/fixtures/startup-config.json"
    )))
    .unwrap()
}

#[test]
fn startup_config_should_match_shared_node_contract() {
    let samples = samples();
    assert!(parse_startup_config(&serde_json::to_vec(&samples["success"]).unwrap(), true).is_ok());
    for key in ["configError", "policyError"] {
        let error =
            parse_startup_config(&serde_json::to_vec(&samples[key]).unwrap(), false).unwrap_err();
        let StartupConfigProbeError::Configuration(error) = error else {
            panic!("expected configuration error")
        };
        assert_eq!(error.data.as_ref(), samples[key]["error"].get("data"));
        assert!(
            error
                .to_string()
                .contains(samples[key]["error"]["data"]["reason"].as_str().unwrap())
        );
        if key == "configError" {
            assert!(error.to_string().contains("/test/.codex/config.toml:1:10"));
        }
    }
}

#[test]
fn startup_config_should_reject_invalid_or_failed_success_output() {
    for value in [
        json!({}),
        json!({"error":{"message":"bad"}}),
        json!({"appServerVersion":"0.164.0", "configRequirements":{"requirements":[]}}),
        json!({"appServerVersion":"0.164.0", "error":{"code":-1,"message":"bad"}}),
    ] {
        assert!(parse_startup_config(&serde_json::to_vec(&value).unwrap(), true).is_err());
    }
    assert!(
        parse_startup_config(&serde_json::to_vec(&samples()["success"]).unwrap(), false).is_err()
    );
}

#[test]
fn startup_config_command_should_preserve_identity_and_path_without_side_effect_flags() {
    let command =
        build_startup_config_command(OsStr::new("codex-test"), Some(OsStr::new("/shell/bin")));
    let args: Vec<_> = command
        .as_std()
        .get_args()
        .map(|value| value.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        &args[..5],
        [
            "app-server",
            "--enable",
            "plugins",
            "--print-startup-config",
            "--startup-client-info"
        ]
    );
    let client: Value = serde_json::from_str(&args[5]).unwrap();
    assert_eq!(client["name"], "codeagent");
    assert_eq!(client["version"], env!("CARGO_PKG_VERSION"));
    assert!(
        command
            .as_std()
            .get_envs()
            .all(|(key, _)| key != "CODEX_HOME")
    );
    assert_eq!(
        command.as_std().get_envs().find(|(key, _)| *key == "PATH"),
        Some((OsStr::new("PATH"), Some(OsStr::new("/shell/bin"))))
    );
}

#[cfg(unix)]
#[tokio::test]
async fn startup_config_probe_should_bound_time_and_both_output_streams() {
    use super::{process::background_process_command, startup_config::probe_command};
    use std::time::Duration;
    for script in ["while :; do :; done", "yes x", "yes x >&2"] {
        let mut command = background_process_command(OsStr::new("/bin/sh"));
        command.args(["-c", script]);
        let error = probe_command(
            command,
            Duration::from_millis(if script.starts_with("while") {
                100
            } else {
                2_000
            }),
        )
        .await
        .unwrap_err();
        if script.starts_with("while") {
            assert!(matches!(error, StartupConfigProbeError::Timeout));
        } else {
            assert!(matches!(error, StartupConfigProbeError::Io(_)));
        }
    }
    let mut command = background_process_command(OsStr::new("/bin/sh"));
    let error = samples()["configError"].to_string();
    command.args(["-c", "printf '%s' \"$1\"; exit 1", "probe", &error]);
    assert!(matches!(
        probe_command(command, Duration::from_secs(2)).await,
        Err(StartupConfigProbeError::Configuration(_))
    ));
}

#[tokio::test]
async fn startup_config_should_preserve_original_when_probe_cannot_run() {
    use super::{process::ProcessError, startup_config::diagnose_startup_failure};
    let program =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("missing-codex-startup-probe");
    let error =
        diagnose_startup_failure(program.as_os_str(), None, ProcessError::InvalidMetadata).await;
    assert!(matches!(error, ProcessError::InvalidMetadata));
}
