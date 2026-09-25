use std::ffi::OsStr;
use std::time::Duration;

use serde_json::{Value, json};

use super::{
    CodexProcess, SUPPORTED_CODEX_VERSION, background_process_creation_flags,
    build_app_server_command, parse_codex_version,
};
use crate::infrastructure::codex::{catalogs, conversation_commands, tasks};

#[test]
fn packaged_shell_should_only_be_disabled_on_unsupported_macos() {
    let mut old = tokio::process::Command::new("codex");
    super::configure_packaged_shell(&mut old, 12);
    assert_eq!(
        old.as_std().get_args().collect::<Vec<_>>(),
        ["--disable", "shell_zsh_fork"]
    );
    let mut modern = tokio::process::Command::new("codex");
    super::configure_packaged_shell(&mut modern, 15);
    assert_eq!(modern.as_std().get_args().count(), 0);
}

#[test]
fn command_should_use_stdio_and_inherit_official_codex_home() {
    let runtime_path = OsStr::new("/shell/node/bin:/usr/bin:/bin");
    let command = build_app_server_command(OsStr::new("codex-test"), Some(runtime_path));
    let command = command.as_std();

    assert_eq!(command.get_program(), "codex-test");
    let expected = vec!["app-server", "--enable", "plugins", "--listen", "stdio://"];
    #[cfg(target_os = "macos")]
    let expected = {
        let mut expected = expected;
        if macos_panel_activation::macos_major_version() < 15 {
            expected.extend(["--disable", "shell_zsh_fork"]);
        }
        expected
    };
    assert_eq!(command.get_args().collect::<Vec<_>>(), expected);
    assert!(command.get_envs().all(|(key, _)| key != "CODEX_HOME"));
    assert_eq!(
        command.get_envs().find(|(key, _)| *key == "RUST_LOG"),
        Some((OsStr::new("RUST_LOG"), Some(OsStr::new("warn"))))
    );
    assert_eq!(
        command.get_envs().find(|(key, _)| *key == "PATH"),
        Some((OsStr::new("PATH"), Some(runtime_path)))
    );
}

#[test]
fn windows_background_process_should_inherit_the_apps_hidden_console() {
    assert_eq!(background_process_creation_flags("windows", true), 0);
    assert_eq!(
        background_process_creation_flags("windows", false),
        0x0800_0000
    );
    assert_eq!(background_process_creation_flags("macos", false), 0);
    assert_eq!(background_process_creation_flags("linux", false), 0);
}

#[test]
fn codex_version_should_require_the_verified_protocol_version() {
    assert_eq!(
        parse_codex_version("codex-cli 0.156.0\n"),
        Some(SUPPORTED_CODEX_VERSION)
    );
    assert_eq!(parse_codex_version("codex-cli 0.152.3\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.152.1\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.153.5\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.153.4\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.154.1\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.156.0-beta.1\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.156.0+build\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.151.0\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.152.0\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.153.0\n"), None);
    assert_eq!(parse_codex_version("codex-cli 1.0.0\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.152.0-beta.1\n"), None);
    assert_eq!(parse_codex_version("codex-cli 0.156.0 unexpected\n"), None);
}

#[tokio::test]
#[ignore = "downloads the private codex-cli 0.156.0 binary"]
async fn private_codex_should_install_and_complete_real_app_server_lifecycle() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let app_data = std::env::temp_dir().join(format!("codeagent-real-install-{unique}"));
    let state = crate::application::state::AppState::default();
    let installed = super::super::runtime_manager::install_codex_runtime(&app_data, |progress| {
        if progress.phase != crate::domain::runtime::CodexRuntimeInstallPhase::Downloading {
            eprintln!("private runtime phase: {:?}", progress.phase);
        }
    })
    .await
    .expect("private installation should succeed");
    assert_eq!(
        installed.status,
        crate::domain::runtime::CodexRuntimeAvailabilityStatus::Compatible
    );
    // 第二次进入不产生安装事件，证明已安装版本可直接复用。
    state
        .inspect_codex(&app_data, |_| panic!("must reuse the private runtime"))
        .await;
    let mut process = CodexProcess::start(&app_data)
        .await
        .expect("installed Codex app-server should start");
    assert_eq!(process.version(), SUPPORTED_CODEX_VERSION);
    assert!(process.binary_path().starts_with(&app_data));
    let connection = process.connection();

    let models: Value = connection
        .request(
            "model/list",
            &json!({"cursor": null, "limit": 1}),
            Duration::from_secs(10),
        )
        .await
        .expect("model catalog should be readable");
    assert!(
        models["data"]
            .as_array()
            .is_some_and(|data| !data.is_empty())
    );

    let cwd = std::env::current_dir().expect("current directory should exist");
    let started: Value = connection
        .request(
            "thread/start",
            &json!({
                "cwd": cwd,
                "ephemeral": true,
                "historyMode": "paginated",
                "projectId": null,
                "runtimeWorkspaceRoots": [],
                "config": {"tools.update_plan.enabled": true},
            }),
            Duration::from_secs(10),
        )
        .await
        .expect("ephemeral thread should start");
    let thread_id = started["thread"]["id"]
        .as_str()
        .expect("thread/start should return an id");
    let read: Value = connection
        .request(
            "thread/read",
            &json!({"includeTurns": false, "threadId": thread_id}),
            Duration::from_secs(10),
        )
        .await
        .expect("ephemeral thread should be readable");
    assert_eq!(read["thread"]["id"], thread_id);
    assert!(read["thread"]["model"].is_string());
    assert!(read["thread"].get("reasoningEffort").is_some());
    // 无运行回合时必须明确返回未应用，验证实验审核方接口而不产生模型请求。
    let reviewer_update =
        super::super::update_live_reviewer(&connection, thread_id, "no-active-turn", "user")
            .await
            .expect("reviewer-only updates should not require step_model_switching");
    assert_eq!(
        serde_json::to_value(reviewer_update).unwrap(),
        "targetUnavailable"
    );

    let mapped_models = catalogs::list_models(&connection)
        .await
        .expect("native model mapping should match the installed server");
    assert!(
        mapped_models["data"]
            .as_array()
            .is_some_and(|data| !data.is_empty())
    );
    let mapped_skills = catalogs::list_skills(&connection, &cwd.to_string_lossy(), false)
        .await
        .expect("native skill mapping should match the installed server");
    assert!(mapped_skills["data"].is_array());

    // 使用产品真实命令创建并立即删除临时任务，验证持久化生命周期参数。
    let agent_settings = serde_json::from_value(json!({
        "webSearch": "live", "modelVerbosity": "high",
    }))
    .unwrap();
    let task = conversation_commands::start_task(
        &connection,
        "temporary".to_owned(),
        Some(&cwd),
        &agent_settings,
    )
    .await
    .expect("CodeAgent temporary task should start");
    super::super::retain_task_writer(&connection, "temporary", &task.task.id)
        .await
        .expect("opening a newly created task should retain its writer without a turn");
    // 仅测试触发空线程持久化；154 本地构建随后可能拒绝 list_turns，以下跨进程断言验证物化结果。
    let _: Result<Value, _> = connection
        .request(
            "thread/read",
            &json!({"includeTurns": true, "threadId": task.task.id}),
            Duration::from_secs(10),
        )
        .await;
    let mut other_process = CodexProcess::start(&app_data)
        .await
        .expect("second client should start");
    let conflict =
        super::super::retain_task_writer(&other_process.connection(), "temporary", &task.task.id)
            .await
            .expect_err("another client must not take the active writer");
    assert!(matches!(
        crate::application::error::AppError::from(conflict),
        crate::application::error::AppError::CodexThreadBusy
    ));
    other_process
        ._child
        .kill()
        .await
        .expect("second client should exit before removing its runtime");
    drop(other_process);
    let deleted = tasks::delete_task(&connection, "temporary".to_owned(), task.task.id)
        .await
        .expect("CodeAgent temporary task should be removable");
    assert_eq!(deleted.response.status, "deleted");
    // kill_on_drop 只发出终止请求；Windows 删除可执行文件前必须等待进程退出。
    process
        ._child
        .kill()
        .await
        .expect("primary client should exit before removing its runtime");
    drop(process);
    std::fs::remove_dir_all(app_data).expect("remove the isolated runtime fixture");
}
