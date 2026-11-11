use super::*;

#[tokio::test]
async fn compiled_acp_host_should_roundtrip_the_native_catalog_and_exit() {
    let Some(host) = std::env::var_os("CODEXLY_COMPILED_ACP_HOST") else {
        return;
    };
    let root = tempfile::tempdir().unwrap();
    let native = std::env::current_exe().unwrap();
    let paths = crate::infrastructure::acp_runtime::AcpRuntimePaths {
        host: host.into(),
        codex: native.clone(),
        claude: native,
    };
    let mut command = HostLaunch::Acp(paths).command(root.path());
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let guard = process::ProcessGuard::configure(&mut command).unwrap();
    let mut child = command.spawn().unwrap();
    let guard = guard.attach(&child).unwrap();
    let (transport, writes) = Transport::new();
    let catalog = LocalCatalog::at(root.path()).unwrap();
    catalog.call("project.put", json!({"id":"原生项目","name":"测试项目","path":root.path().to_string_lossy(),"createdAt":"2026-11-09T00:00:00Z"})).await.unwrap();
    let (catalog_sender, catalog_receiver) = mpsc::channel(64);
    let mut tasks = JoinSet::new();
    tasks.spawn(transport::writer_loop(
        child.stdin.take().unwrap(),
        writes,
        Arc::clone(&transport),
    ));
    tasks.spawn(workers::catalog_loop(
        catalog_receiver,
        catalog.clone(),
        Arc::clone(&transport),
        None,
    ));
    tasks.spawn(transport::reader_loop(
        child.stdout.take().unwrap(),
        Arc::clone(&transport),
        catalog_sender,
        vec![],
    ));
    let root_path = root.path().to_string_lossy();
    let result = transport.request("task.start", Some(json!({"id":"原生项目","kind":"project","rootPath":root_path,"runtimeWorkspaceRoots":[root_path]})), json!({"engine":"claude"}), Instant::now() + Duration::from_secs(10)).await;
    let rejected = transport.request_acp("prompt.start", Some(json!({"id":"原生项目","kind":"project","rootPath":root_path,"runtimeWorkspaceRoots":[root_path]})),json!({"taskId":"missing","input":{"text":"继续","files":[],"images":[],"skills":[],"textAttachments":[]}}),Instant::now()+Duration::from_secs(10)).await;
    // 无论断言结果如何先回收宿主和 worker，避免失败测试留下子进程。
    transport.fail("test finished");
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    guard.shutdown(&mut child).await;
    assert_eq!(rejected.unwrap_err(), "ACP_HOST_PROMPT_NOT_SUBMITTED");
    let result = result.unwrap();
    assert_eq!(result["engine"], "claude");
    let task = catalog
        .call("task.read", json!({"id":result["id"]}))
        .await
        .unwrap();
    assert_eq!(task["projectId"], "原生项目");
    assert_eq!(task["provider"], "claude");
}
