# Get started with Codexly

[Documentation](README.md) · [简体中文](getting-started.md)

Choose a client, connect Codex or Claude, and start your first task in a local project.

## Choose a client

- **Desktop**: download from [Releases](https://github.com/BryanHoo/Codexly/releases) and follow [installation](../desktop/docs/installation.en.md). Runtimes are bundled; no separate Node.js, Bun, or CLI is needed. macOS Legacy supports Codex only.
- **Computer browser**: install Node.js 24+, run the command below, and open the printed local address.
- **Phone or tablet**: add `--lan` to the command on your computer, then open the printed LAN address on your mobile device and enter the password. See [Web and mobile](web.en.md).

```bash
npx --package @bryanhu/codexly@latest codexly start
```

Desktop opens directly into the workspace; configure connections in Settings. Web provides first-use setup. Supported existing local configurations are recognized. You can configure just one agent and add the other later.

## Connect an agent

### Codex

Use ChatGPT sign-in or configure a compatible API URL and key. Custom services must support the OpenAI Responses API and a model list. Select a model available through that connection; reasoning options follow its reported capabilities.

### Claude

Reuse supported Claude Code credentials on the host computer, or enter a service URL and key in Claude connection settings. The official API URL is `https://api.anthropic.com`; compatible services must support Anthropic Messages and `/v1/models`. Click the connection or save button to save credentials; typing or leaving the field does not submit them.

In-app Claude account login is unavailable. Connection checks read the model list without a generation request; success does not verify inference credits or every model permission.

Choose Haiku, Sonnet, or Opus. For gateways using custom model IDs, configure their mappings in Claude agent settings; official connections can usually leave mappings empty. Claude-only setups support conversations, common settings, Git commit message generation, and schedules without Codex configuration.

### Where settings apply

Desktop reads the local user's configuration. Web and mobile change configuration on the Web host, not on the browser device. Default directories are `~/.codex` and `~/.claude`, overridden by `CODEX_HOME` and `CLAUDE_CONFIG_DIR` respectively.

Credentials, model access, and charges belong to your chosen provider. Codexly includes no model credits. Relevant project content is sent to that service as part of agent execution.

## Start a task

1. Add a folder as a project in the sidebar. Mobile selects a folder on the Web host.
2. Open the project and create a task. Choose Codex or Claude in the composer when both are available; a single configured engine is selected automatically.
3. Select a model and permissions. Permission semantics differ by engine; confirmation-based modes help you inspect operations.
4. Describe a concrete goal, such as “Explain how this project starts and find its test entry points.” Attach files, reference project files with `@`, or Skills with `$` as needed.
5. Follow execution and respond to approvals or questions. Review code changes in the Changes panel before committing.

Use **New task** for a conversation without a project. Existing tasks keep their engine; create a new task to use the other agent.

## Next steps

- [Workspace guide](usage.en.md): steering, queues, panes, files, and schedules.
- [Git workflow](git-workflow.md): branches, worktrees, commits, and pushes; includes English instructions.
- [FAQ (中文)](faq.md): connections, shared data, and updates.
- [Agent reference (中文)](agent-engines.md): native configuration, permissions, and extensions.
