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
    let (event_sender, mut event_receiver) = mpsc::channel::<transport::Routed>(64);
    let observed_events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured_events = Arc::clone(&observed_events);
    let (events_ready, events_delivered) = tokio::sync::oneshot::channel();
    let mut tasks = JoinSet::new();
    // 管理操作会发事件；夹具同生产一样提供非空 lane，并真正消费以释放字节预算。
    tasks.spawn(async move {
        let mut events_ready = Some(events_ready);
        while let Some(frame) = event_receiver.recv().await {
            let count = {
                let mut events = captured_events.lock().unwrap();
                events.push(frame.message);
                events.len()
            };
            if count >= 5
                && let Some(ready) = events_ready.take()
            {
                let _ = ready.send(());
            }
        }
    });
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
        vec![event_sender],
    ));
    let root_path = root.path().to_string_lossy();
    let result = transport.request("task.start", Some(json!({"id":"原生项目","kind":"project","rootPath":root_path,"runtimeWorkspaceRoots":[root_path]})), json!({"engine":"claude"}), Instant::now() + Duration::from_secs(10)).await;
    let rejected = transport.request_acp("prompt.start", Some(json!({"id":"原生项目","kind":"project","rootPath":root_path,"runtimeWorkspaceRoots":[root_path]})),json!({"taskId":"missing","input":{"text":"继续","files":[],"images":[],"skills":[],"textAttachments":[]}}),Instant::now()+Duration::from_secs(10)).await;
    // 真实 SQLite 目录回调与编译宿主贯通；保留/释放本身不能启动 agent。
    let mut subscriptions = Vec::new();
    if let Ok(task) = &result {
        for (project, method, lease) in [
            ("原生项目", "task.retain", "view-one"),
            ("原生项目", "task.retain", "view-one"),
            ("原生项目", "task.retain", "view-two"),
            ("原生项目", "task.release", "view-one"),
            ("原生项目", "task.release", "view-two"),
            ("原生项目", "task.release", "view-two"),
            ("其他项目", "task.retain", "view-three"),
        ] {
            subscriptions.push(transport.request_acp(method, Some(json!({"id":project,"kind":"project","rootPath":root_path,"runtimeWorkspaceRoots":[root_path]})), json!({"taskId":task["id"],"leaseId":lease}), Instant::now()+Duration::from_secs(10)).await);
        }
    }
    let managed_task = transport.request_acp("task.start", Some(json!({"id":"原生项目","kind":"project","rootPath":root_path,"runtimeWorkspaceRoots":[root_path]})), json!({"engine":"codex"}), Instant::now()+Duration::from_secs(10)).await;
    let mut mutations = Vec::new();
    if let Ok(task) = &managed_task {
        for (method, mut params) in [
            ("task.pin", json!({"pinned":true})),
            ("task.rename", json!({"title":"编译宿主权威标题"})),
            ("task.archive", json!({})),
            ("task.unarchive", json!({})),
            ("task.delete", json!({})),
        ] {
            params["taskId"] = task["id"].clone();
            let response = async {
                transport.request_acp(method, Some(json!({"id":"原生项目","kind":"project","rootPath":root_path,"runtimeWorkspaceRoots":[root_path]})), params, Instant::now()+Duration::from_secs(10)).await?;
                // 同生产边界一样，宿主确认后从真实目录包装原生 DTO。
                super::super::acp_task_management::response(&catalog, "原生项目", task["id"].as_str().ok_or("Missing task id")?, method)
                    .await.map_err(|error| error.to_string())?
                    .ok_or_else(|| "Missing management response".to_owned())
            }.await;
            mutations.push(response);
        }
    }
    let events_delivered = tokio::time::timeout(Duration::from_secs(3), events_delivered).await;
    // 无论断言结果如何先回收宿主和 worker，避免失败测试留下子进程。
    transport.fail("test finished");
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    guard.shutdown(&mut child).await;
    assert_eq!(rejected.unwrap_err(), "ACP_HOST_PROMPT_NOT_SUBMITTED");
    assert_eq!(subscriptions.len(), 7);
    assert!(
        subscriptions[..6].iter().all(Result::is_ok),
        "{subscriptions:?}"
    );
    assert_eq!(
        subscriptions[6].as_ref().unwrap_err(),
        "ACP_HOST_REQUEST_FAILED"
    );
    let result = result.unwrap();
    assert_eq!(result["engine"], "claude");
    let task = catalog
        .call("task.read", json!({"id":result["id"]}))
        .await
        .unwrap();
    assert_eq!(task["projectId"], "原生项目");
    assert_eq!(task["provider"], "claude");
    assert!(matches!(events_delivered, Ok(Ok(()))));
    {
        let events = observed_events.lock().unwrap();
        assert_eq!(events.len(), 5);
        assert!(
            events
                .iter()
                .all(|frame| frame["event"]["provider"] == "codex")
        );
    }
    let managed_task = managed_task.unwrap();
    let mutations = mutations
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(mutations.len(), 5);
    assert_eq!(mutations[0]["task"]["id"], managed_task["id"]);
    assert_eq!(mutations[0]["task"]["pinned"], true);
    assert_eq!(mutations[1]["task"]["title"], "编译宿主权威标题");
    assert_eq!(
        mutations[2],
        json!({"status":"archived","taskId":managed_task["id"]})
    );
    assert_eq!(mutations[3]["task"]["title"], "编译宿主权威标题");
    assert_eq!(
        mutations[4],
        json!({"status":"deleted","taskId":managed_task["id"]})
    );
    assert!(
        catalog
            .call("task.read", json!({"id":managed_task["id"]}))
            .await
            .unwrap()
            .is_null()
    );
}
