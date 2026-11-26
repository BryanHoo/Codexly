# Get started with Codexly

[Documentation](README.md) · [简体中文](getting-started.md)

Choose a client, connect an ACP agent, and start your first task in a local project.

## Choose a client

- **Desktop**: download from [Releases](https://github.com/BryanHoo/Codexly/releases) and follow [installation](../desktop/docs/installation.en.md). The package includes the ACP host.
- **Computer browser**: install Node.js 24+, run the command below, and open the printed local address.
- **Phone or tablet**: add `--lan` to the command on your computer, then open the printed LAN address on your mobile device and enter the password. See [Web and mobile](web.en.md).

```bash
npx --package @bryanhu/codexly@latest codexly start
```

Desktop opens directly into the workspace; configure connections in Settings. Web provides first-use setup. Supported existing local configurations are recognized. You can configure just one agent and add the other later.

## Connect an agent

1. Open **Settings → ACP → Add Agent**, then choose **Install and enable** from the catalog or configure a custom ACP command.
2. Complete authentication using an option offered by the agent. If the agent relies on original credentials, configure them on the host running Codexly.
3. Check available models and session options in the agent settings. Desktop uses the local computer. Web and mobile use the Web server's environment. [Agent reference (中文)](agent-engines.md)

## Start a task

1. Add a folder as a project in the sidebar. Mobile selects a folder on the Web host.
2. Open the project, create a task, and choose an enabled agent in the composer.
3. Select a model and permissions. Permission semantics differ by engine; confirmation-based modes help you inspect operations.
4. Describe a concrete goal, such as “Explain how this project starts and find its test entry points.” Attach files, reference project files with `@`, or Skills with `$` as needed.
5. Follow execution and respond to approvals or questions. Review code changes in the Changes panel before committing.

Use **New task** for a conversation without a project. Existing tasks keep their engine; create a new task to use the other agent.

## Next steps

- [Workspace guide](usage.en.md): steering, queues, panes, files, and schedules.
- [Git workflow](git-workflow.md): branches, worktrees, commits, and pushes; includes English instructions.
- [FAQ (中文)](faq.md): connections, shared data, and updates.
- [Agent reference (中文)](agent-engines.md): native configuration, permissions, and extensions.
